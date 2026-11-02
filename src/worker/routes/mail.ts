import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { SWIPE_ACTIONS, type ComposeInput, type Me } from "../../shared/types";
import { isAddress } from "../lib/address";
import type { AppEnv } from "../middleware";
import { MAX_UPLOAD_BYTES, getAttachment, saveUpload } from "../services/attachments";
import { addressesFor, enabledDomains, profile, setDisplayName, setPreferences } from "../services/directory";
import {
  deleteMessage,
  deleteThread,
  emptyBin,
  getMessage,
  getThread,
  listThreads,
  setThreadRead,
  setThreadStarred,
  trashMessage,
  trashThread,
  unreadByMailbox,
} from "../services/messages";
import { ComposeError, saveDraft, sendDraft } from "../services/outbound";
import { addFcmToken, removeFcmToken } from "../services/fcm";
import { addSubscription, notifyUser, pushPublicKey, removeSubscription } from "../services/push";

const address = z.string().max(320).refine(isAddress, "Not an email address");

const compose = z.object({
  from: z.string().max(320),
  to: z.array(address).max(50),
  cc: z.array(address).max(50).default([]),
  bcc: z.array(address).max(50).default([]),
  subject: z.string().max(998),
  text: z.string().max(1_000_000),
  attachmentIds: z.array(z.uuid()).max(50).default([]),
  replyTo: z.uuid().nullish(),
}) satisfies z.ZodType<ComposeInput, unknown>;

const listQuery = z.object({
  folder: z.enum(["inbox", "sent", "drafts", "bin", "starred"]).default("inbox"),
  mailbox: z.string().max(320).optional(),
  cursor: z.string().regex(/^\d{1,15}\.[0-9a-f-]{36}$/).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// Shown inline (in the email frame or the lightbox) only when it's an image
// type a browser can't be talked into running script from.
/** ?forever=1 skips the Bin. */
const forever = z.object({ forever: z.literal("1").optional() });

const INLINE_SAFE = /^image\/(png|jpe?g|gif|webp|avif|bmp)$/i;

function composeError(err: unknown): string {
  if (err instanceof ComposeError) return err.message;
  if (err instanceof Error && err.message === "Unknown attachment") return "One of the attachments is gone.";
  throw err;
}

export const mail = new Hono<AppEnv>()
  .get("/me", async (c) => {
    const { username, isAdmin } = c.get("user");
    const [prof, addresses, domains] = await Promise.all([
      profile(c.env, username),
      addressesFor(c.env, username),
      enabledDomains(c.env),
    ]);
    return c.json<Me>({ username, ...prof, isAdmin, addresses, domains, pushPublicKey: pushPublicKey(c.env) });
  })

  .patch(
    "/me/preferences",
    zValidator(
      "json",
      z.object({
        usePicture: z.boolean().optional(),
        swipeLeft: z.enum(SWIPE_ACTIONS).optional(),
        swipeRight: z.enum(SWIPE_ACTIONS).optional(),
      }),
    ),
    async (c) => c.json(await setPreferences(c.env, c.get("user").username, c.req.valid("json"))),
  )

  // An empty name is kept as "" rather than NULL, so the SSO's doesn't come back on the next sign-in.
  .patch("/me", zValidator("json", z.object({ name: z.string().trim().max(100) })), async (c) => {
    const { name } = c.req.valid("json");
    await setDisplayName(c.env, c.get("user").username, name);
    return c.json({ name: name || null });
  })

  .get("/threads", zValidator("query", listQuery), async (c) =>
    c.json(await listThreads(c.env, c.get("user").username, c.req.valid("query"))),
  )

  .get("/threads/:id", zValidator("query", z.object({ bin: z.literal("1").optional() })), async (c) => {
    const thread = await getThread(c.env, c.get("user").username, c.req.param("id"), !!c.req.valid("query").bin);
    return thread ? c.json(thread) : c.json({ error: "Not found" }, 404);
  })

  .post("/threads/:id/read", zValidator("json", z.object({ read: z.boolean() })), async (c) => {
    const user = c.get("user").username;
    await setThreadRead(c.env, user, c.req.param("id"), c.req.valid("json").read);
    return c.json({ unread: await unreadByMailbox(c.env, user) });
  })

  .post("/threads/:id/star", zValidator("json", z.object({ starred: z.boolean() })), async (c) => {
    const { starred } = c.req.valid("json");
    const found = await setThreadStarred(c.env, c.get("user").username, c.req.param("id"), starred);
    return found ? c.json({ starred }) : c.json({ error: "Not found" }, 404);
  })

  /** Moves the thread to the Bin; with ?forever=1, deletes what of it is already there. */
  .delete("/threads/:id", zValidator("query", forever), async (c) => {
    const user = c.get("user").username;
    const id = c.req.param("id");
    const count = c.req.valid("query").forever ? await deleteThread(c.env, user, id) : await trashThread(c.env, user, id);
    return count ? c.json({ count }) : c.json({ error: "Not found" }, 404);
  })

  .post("/threads/:id/restore", async (c) => {
    const count = await trashThread(c.env, c.get("user").username, c.req.param("id"), false);
    return count ? c.json({ count }) : c.json({ error: "Not found" }, 404);
  })

  .delete("/bin", async (c) => c.json({ count: await emptyBin(c.env, c.get("user").username) }))

  .get("/messages/:id", async (c) => {
    const message = await getMessage(c.env, c.get("user").username, c.req.param("id"));
    return message ? c.json(message) : c.json({ error: "Not found" }, 404);
  })

  /** Moves the message to the Bin; with ?forever=1, deletes it wherever it is. */
  .delete("/messages/:id", zValidator("query", forever), async (c) => {
    const user = c.get("user").username;
    const id = c.req.param("id");
    const count = c.req.valid("query").forever ? await deleteMessage(c.env, user, id) : await trashMessage(c.env, user, id);
    return count ? c.json({ count }) : c.json({ error: "Not found" }, 404);
  })

  .post("/messages/:id/restore", async (c) => {
    const count = await trashMessage(c.env, c.get("user").username, c.req.param("id"), false);
    return count ? c.json({ count }) : c.json({ error: "Not found" }, 404);
  })

  .get("/unread", async (c) => c.json({ unread: await unreadByMailbox(c.env, c.get("user").username) }))

  .post("/uploads", async (c) => {
    // parseBody buffers the whole request, so turn away oversized ones before reading them.
    if (Number(c.req.header("content-length") ?? 0) > MAX_UPLOAD_BYTES + 64 * 1024) {
      return c.json({ error: "Attachments can be up to 25 MB each." }, 413);
    }
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
        endpoint: z.url({ protocol: /^https$/ }).max(2048),
        keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
      }),
    ),
    async (c) => {
      const added = await addSubscription(c.env, c.get("user").username, c.req.valid("json"));
      return added ? c.json({ ok: true }) : c.json({ error: "Too many devices have notifications on." }, 400);
    },
  )

  .post("/push/unsubscribe", zValidator("json", z.object({ endpoint: z.string().max(2048) })), async (c) => {
    await removeSubscription(c.env, c.get("user").username, c.req.valid("json").endpoint);
    return c.json({ ok: true });
  })

  /** The Android app's FCM token, registered after sign-in and whenever Firebase rotates it. */
  .post("/push/fcm", zValidator("json", z.object({ token: z.string().min(1).max(4096) })), async (c) => {
    const added = await addFcmToken(c.env, c.get("user").username, c.req.valid("json").token);
    return added ? c.json({ ok: true }) : c.json({ error: "Too many devices have notifications on." }, 400);
  })

  .post("/push/fcm/unregister", zValidator("json", z.object({ token: z.string().max(4096) })), async (c) => {
    await removeFcmToken(c.env, c.get("user").username, c.req.valid("json").token);
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
