import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { AliasInfo, DomainInfo, UserInfo } from "../../shared/types";
import { addressesOf } from "../lib/routing";
import { requireAdmin, type AppEnv } from "../middleware";
import { purgeObjects } from "../services/attachments";
import { loadDirectory } from "../services/directory";
import { deleteAllFor } from "../services/messages";
import { resend } from "../services/resend";

const domainName = z
  .string()
  .toLowerCase()
  .regex(/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/, "Not a domain name");
const localPart = z
  .string()
  .toLowerCase()
  .regex(/^[a-z0-9._+-]{1,64}$/, "Use letters, digits and . _ + - only");

// Path segment for "every domain", since an alias's domain can be "".
const ANY = "*";

export const admin = new Hono<AppEnv>()
  .use(requireAdmin)

  /** Domains enabled here, merged with what Resend reports so new ones can be switched on. */
  .get("/domains", async (c) => {
    const [{ results }, remote] = await Promise.all([
      c.env.DB.prepare("SELECT name, enabled, catch_all FROM domains ORDER BY name").all<{
        name: string;
        enabled: number;
        catch_all: string | null;
      }>(),
      resend(c.env)
        .domains.list()
        .catch((err: unknown) => ({ data: null, error: err })),
    ]);
    const byName = new Map<string, DomainInfo>();
    for (const d of remote.data?.data ?? []) {
      byName.set(d.name.toLowerCase(), {
        name: d.name.toLowerCase(),
        enabled: false,
        catchAll: null,
        resend: {
          status: d.status,
          sending: d.capabilities?.sending === "enabled",
          receiving: d.capabilities?.receiving === "enabled",
        },
      });
    }
    for (const row of results) {
      const known = byName.get(row.name);
      byName.set(row.name, {
        name: row.name,
        enabled: row.enabled === 1,
        catchAll: row.catch_all,
        resend: known?.resend ?? null,
      });
    }
    return c.json([...byName.values()].sort((a, b) => a.name.localeCompare(b.name)));
  })

  .put(
    "/domains/:name",
    zValidator("param", z.object({ name: domainName })),
    zValidator("json", z.object({ enabled: z.boolean(), catchAll: z.string().toLowerCase().nullable() })),
    async (c) => {
      const { name } = c.req.valid("param");
      const { enabled, catchAll } = c.req.valid("json");
      try {
        await c.env.DB.prepare(
          "INSERT INTO domains (name, enabled, catch_all, created_at) VALUES (?, ?, ?, ?) " +
            "ON CONFLICT (name) DO UPDATE SET enabled = excluded.enabled, catch_all = excluded.catch_all",
        )
          .bind(name, enabled ? 1 : 0, catchAll || null, Date.now())
          .run();
      } catch {
        return c.json({ error: `There's no user called ${catchAll}.` }, 400);
      }
      return c.json({ ok: true });
    },
  )

  .delete("/domains/:name", async (c) => {
    // Aliases pinned to the domain go too; mail already received stays.
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM aliases WHERE domain = ?").bind(c.req.param("name")),
      c.env.DB.prepare("DELETE FROM domains WHERE name = ?").bind(c.req.param("name")),
    ]);
    return c.json({ ok: true });
  })

  .get("/aliases", async (c) => {
    const { results } = await c.env.DB.prepare(
      "SELECT local_part, domain, username FROM aliases ORDER BY local_part, domain",
    ).all<{ local_part: string; domain: string; username: string }>();
    return c.json(
      results.map((r): AliasInfo => ({ localPart: r.local_part, domain: r.domain, username: r.username })),
    );
  })

  .post(
    "/aliases",
    zValidator(
      "json",
      z.object({ localPart, domain: z.union([z.literal(""), domainName]), username: z.string().toLowerCase() }),
    ),
    async (c) => {
      const { localPart: local, domain, username } = c.req.valid("json");
      // An alias over someone's username would quietly take their mail.
      const clash = await c.env.DB.prepare("SELECT 1 FROM users WHERE username = ? AND username != ?")
        .bind(local, username)
        .first();
      if (clash) return c.json({ error: `${local} is someone's username.` }, 400);
      try {
        await c.env.DB.prepare(
          "INSERT INTO aliases (local_part, domain, username, created_at) VALUES (?, ?, ?, ?) " +
            "ON CONFLICT (local_part, domain) DO UPDATE SET username = excluded.username",
        )
          .bind(local, domain, username, Date.now())
          .run();
      } catch {
        return c.json({ error: `There's no user called ${username}.` }, 400);
      }
      return c.json({ ok: true });
    },
  )

  .delete("/aliases/:domain/:local", async (c) => {
    const domain = c.req.param("domain") === ANY ? "" : c.req.param("domain");
    await c.env.DB.prepare("DELETE FROM aliases WHERE local_part = ? AND domain = ?")
      .bind(c.req.param("local"), domain)
      .run();
    return c.json({ ok: true });
  })

  .get("/users", async (c) => {
    const [{ results }, dir] = await Promise.all([
      c.env.DB.prepare(
        "SELECT u.username, u.is_admin, u.created_at, u.last_login_at, " +
          "(SELECT COUNT(*) FROM messages m WHERE m.owner = u.username) AS n FROM users u ORDER BY u.username",
      ).all<{ username: string; is_admin: number; created_at: number; last_login_at: number; n: number }>(),
      loadDirectory(c.env),
    ]);
    return c.json(
      results.map(
        (r): UserInfo => ({
          username: r.username,
          isAdmin: r.is_admin === 1,
          createdAt: r.created_at,
          lastLoginAt: r.last_login_at,
          messageCount: r.n,
          addresses: addressesOf(dir, r.username),
        }),
      ),
    );
  })

  .patch("/users/:username", zValidator("json", z.object({ isAdmin: z.boolean() })), async (c) => {
    const username = c.req.param("username").toLowerCase();
    if (username === c.get("user").username && !c.req.valid("json").isAdmin) {
      return c.json({ error: "You can't remove your own admin rights." }, 400);
    }
    await c.env.DB.prepare("UPDATE users SET is_admin = ? WHERE username = ?")
      .bind(c.req.valid("json").isAdmin ? 1 : 0, username)
      .run();
    return c.json({ ok: true });
  })

  /**
   * Deletes a user and all their mail. They can sign in again through the
   * SSO and start over with an empty mailbox.
   */
  .delete("/users/:username", async (c) => {
    const username = c.req.param("username").toLowerCase();
    if (username === c.get("user").username) return c.json({ error: "You can't delete your own account." }, 400);
    const deletedMail = await deleteAllFor(c.env, username);
    const { results: uploads } = await c.env.DB.prepare("DELETE FROM attachments WHERE owner = ? RETURNING r2_key")
      .bind(username)
      .all<{ r2_key: string }>();
    await purgeObjects(c.env, uploads.map((u) => u.r2_key));
    await c.env.DB.prepare("DELETE FROM users WHERE username = ?").bind(username).run();
    return c.json({ ok: true, deletedMail });
  });
