import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { ComposeInput, Me } from "../../shared/types";
import { isAddress } from "../lib/address";
import type { AppEnv } from "../middleware";
import { MAX_UPLOAD_BYTES, getAttachment, saveUpload } from "../services/attachments";
import { addressesFor, enabledDomains } from "../services/directory";
import {
  deleteMessage,
  deleteThread,
  getMessage,
  getThread,
  listThreads,
  setThreadRead,
  unreadByMailbox,
} from "../services/messages";
import { ComposeError, saveDraft, sendDraft } from "../services/outbound";
import { addSubscription, notifyUser, pushPublicKey, removeSubscription } from "../services/push";

const address = z.string().max(320).refine(isAddress, "Not an email address");

const compose = z.object({
  from: z.string().max(320),
  to: z.array(address).max(50),
  cc: z.array(address).max(50).default([]),
  subject: z.string().max(998),
  text: z.string().max(1_000_000),
  attachmentIds: z.array(z.uuid()).max(50).default([]),
  replyTo: z.uuid().nullish(),
}) satisfies z.ZodType<ComposeInput, unknown>;

const listQuery = z.object({
  folder: z.enum(["inbox", "sent", "drafts"]).default("inbox"),
  mailbox: z.string().max(320).optional(),
  cursor: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// Shown inline (in the email frame or the lightbox) only when it's an image
// type a browser can't be talked into running script from.
const INLINE_SAFE = /^image\/(png|jpe?g|gif|webp|avif|bmp)$/i;

function composeError(err: unknown): string {
  if (err instanceof ComposeError) return err.message;
  if (err instanceof Error && err.message === "Unknown attachment") return "One of the attachments is gone.";
  throw err;
}

export const mail = new Hono<AppEnv>()
  .get("/me", async (c) => {
    const { username, isAdmin } = c.get("user");
    const [addresses, domains] = await Promise.all([addressesFor(c.env, username), enabledDomains(c.env)]);
    return c.json<Me>({ username, isAdmin, addresses, domains, pushPublicKey: pushPublicKey(c.env) });
  })

  .get("/threads", zValidator("query", listQuery), async (c) =>
    c.json(await listThreads(c.env, c.get("user").username, c.req.valid("query"))),
  )

  .get("/threads/:id", async (c) => {
    const thread = await getThread(c.env, c.get("user").username, c.req.param("id"));
    return thread ? c.json(thread) : c.json({ error: "Not found" }, 404);
  })

  .post("/threads/:id/read", zValidator("json", z.object({ read: z.boolean() })), async (c) => {
    const user = c.get("user").username;
    await setThreadRead(c.env, user, c.req.param("id"), c.req.valid("json").read);
    return c.json({ unread: await unreadByMailbox(c.env, user) });
  })

  .delete("/threads/:id", async (c) => {
    const count = await deleteThread(c.env, c.get("user").username, c.req.param("id"));
    return count ? c.json({ count }) : c.json({ error: "Not found" }, 404);
  })

  .get("/messages/:id", async (c) => {
    const message = await getMessage(c.env, c.get("user").username, c.req.param("id"));
    return message ? c.json(message) : c.json({ error: "Not found" }, 404);
  })

  .delete("/messages/:id", async (c) => {
    const count = await deleteMessage(c.env, c.get("user").username, c.req.param("id"));
    return count ? c.json({ count }) : c.json({ error: "Not found" }, 404);
  })

  .get("/unread", async (c) => c.json({ unread: await unreadByMailbox(c.env, c.get("user").username) }))

  .post("/uploads", async (c) => {
    const body = await c.req.parseBody();
    const file = body["file"];
    if (!(file instanceof File)) return c.json({ error: "file is required" }, 400);
    if (file.size > MAX_UPLOAD_BYTES) return c.json({ error: "Attachments can be up to 25 MB each." }, 413);
    return c.json(await saveUpload(c.env, c.get("user").username, file));
  })

  .get("/attachments/:id", async (c) => {
    const meta = await getAttachment(c.env, c.get("user").username, c.req.param("id"));
    const obj = meta && (await c.env.BUCKET.get(meta.r2Key));
    if (!meta || !obj) return c.json({ error: "Not found" }, 404);

    const inline = c.req.query("inline") === "1" && INLINE_SAFE.test(meta.contentType);
    return new Response(obj.body, {
      headers: {
        "Content-Type": inline ? meta.contentType : "application/octet-stream",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(meta.filename)}`,
        "Content-Length": String(obj.size),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cache-Control": "private, max-age=86400",
      },
    });
  })

  .post("/drafts", zValidator("json", compose), async (c) => {
    try {
      return c.json({ id: await saveDraft(c.env, c.get("user").username, c.req.valid("json")) });
    } catch (err) {
      return c.json({ error: composeError(err) }, 400);
    }
  })

  .put("/drafts/:id", zValidator("json", compose), async (c) => {
    try {
      return c.json({ id: await saveDraft(c.env, c.get("user").username, c.req.valid("json"), c.req.param("id")) });
    } catch (err) {
      return c.json({ error: composeError(err) }, 400);
    }
  })

  /** Saves (or updates draftId) then sends. A failed send leaves it in Drafts. */
  .post("/send", zValidator("json", compose.extend({ draftId: z.uuid().nullish() })), async (c) => {
    const user = c.get("user").username;
    const { draftId, ...input } = c.req.valid("json");
    let id: string | undefined;
    try {
      id = await saveDraft(c.env, user, input, draftId ?? undefined);
      return c.json(await sendDraft(c.env, user, id));
    } catch (err) {
      return c.json({ error: composeError(err), draftId: id ?? null }, 400);
    }
  })

  .post(
    "/push/subscribe",
    zValidator(
      "json",
      z.object({
        endpoint: z.url().max(2048),
        keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
      }),
    ),
    async (c) => {
      await addSubscription(c.env, c.get("user").username, c.req.valid("json"));
      return c.json({ ok: true });
    },
  )

  .post("/push/unsubscribe", zValidator("json", z.object({ endpoint: z.string().max(2048) })), async (c) => {
    await removeSubscription(c.env, c.get("user").username, c.req.valid("json").endpoint);
    return c.json({ ok: true });
  })

  .post("/push/test", async (c) =>
    c.json(
      await notifyUser(c.env, c.get("user").username, {
        title: "Test notification",
        body: "Your inbox notifications are working.",
        url: "/inbox",
        tag: "mailbox-test",
      }),
    ),
  );
