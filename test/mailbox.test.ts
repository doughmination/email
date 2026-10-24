import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import type { Page, Thread, ThreadSummary } from "../src/shared/types";
import { setMessageAttachments } from "../src/worker/services/attachments";
import { routeRecipients } from "../src/worker/services/directory";
import { insertMessage, resolveThread } from "../src/worker/services/messages";

const ORIGIN = "https://mail.test";

async function signIn(username: string, isAdmin = false): Promise<string> {
  const now = Date.now();
  await env.DB.prepare("INSERT INTO users (username, sub, is_admin, created_at, last_login_at) VALUES (?, ?, ?, ?, ?)")
    .bind(username, `sub-${username}`, isAdmin ? 1 : 0, now, now)
    .run();
  const token = crypto.randomUUID();
  const ts = Math.floor(now / 1000);
  const session = { username, sub: `sub-${username}`, refreshToken: null, idToken: null, createdAt: ts, verifiedAt: ts, checkedAt: ts };
  await env.DB.prepare("INSERT INTO sessions (token, data, expires_at) VALUES (?, ?, ?)")
    .bind(token, JSON.stringify(session), ts + 3600)
    .run();
  return token;
}

function call(token: string, path: string, init: RequestInit = {}) {
  return exports.default.fetch(
    new Request(`${ORIGIN}${path}`, {
      ...init,
      headers: { cookie: `session=${token}`, origin: ORIGIN, ...(init.headers ?? {}) },
    }),
  );
}

/** Stores an inbound message for `owner` the same way the webhook does. */
async function deliver(owner: string, subject: string, extra: { messageId?: string; inReplyTo?: string } = {}) {
  const threadId = await resolveThread(env, owner, {
    inReplyTo: extra.inReplyTo ?? null,
    refs: null,
    subject,
    counterpart: "sender@example.com",
    sentAt: Date.now(),
  });
  const id = crypto.randomUUID();
  await insertMessage(env, threadId, {
    id,
    owner,
    folder: "inbox",
    mailbox: `${owner}@doughmination.gay`,
    resend_id: crypto.randomUUID(),
    message_id: extra.messageId ?? null,
    in_reply_to: extra.inReplyTo ?? null,
    refs: null,
    from_addr: "Sender <sender@example.com>",
    to_addrs: JSON.stringify([`${owner}@doughmination.gay`]),
    cc_addrs: "[]",
    subject,
    html: "<p>hi</p>",
    text: "hi",
    sent_at: Date.now(),
    read: false,
  });
  return { id, threadId };
}

let clove: string;
let ari: string;

beforeAll(async () => {
  clove = await signIn("clove", true);
  ari = await signIn("ari");
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO domains (name, enabled, catch_all, created_at, receiving) VALUES ('doughmination.gay', 1, 'clove', 0, 1)",
    ),
    env.DB.prepare(
      "INSERT INTO domains (name, enabled, catch_all, created_at, receiving) VALUES ('doughmination.win', 1, NULL, 0, 1)",
    ),
    env.DB.prepare("INSERT INTO aliases (local_part, domain, username, created_at) VALUES ('ctf', '', 'clove', 0)"),
  ]);
});

describe("auth", () => {
  it("rejects requests without a session", async () => {
    const res = await exports.default.fetch(new Request(`${ORIGIN}/api/me`));
    expect(res.status).toBe(401);
  });

  it("refuses cross-site writes", async () => {
    const res = await call(clove, "/api/threads/x/read", {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      body: JSON.stringify({ read: true }),
    });
    expect(res.status).toBe(403);
  });

  it("lists addresses across domains, with aliases", async () => {
    const me = (await (await call(clove, "/api/me")).json()) as { addresses: string[]; isAdmin: boolean };
    expect(me.isAdmin).toBe(true);
    expect(me.addresses).toEqual([
      "clove@doughmination.gay",
      "clove@doughmination.win",
      "ctf@doughmination.gay",
      "ctf@doughmination.win",
    ]);
  });

  it("keeps admin pages to admins", async () => {
    expect((await call(ari, "/api/admin/users")).status).toBe(403);
  });
});

describe("delivery", () => {
  it("puts one email into every addressed mailbox", async () => {
    const owners = await routeRecipients(env, [
      "Clove <clove@doughmination.win>",
      "ari@doughmination.gay",
      "ctf@doughmination.gay",
      "stranger@doughmination.win",
    ]);
    expect(Object.fromEntries(owners)).toEqual({
      clove: "clove@doughmination.win",
      ari: "ari@doughmination.gay",
    });
  });

  it("threads a reply by In-Reply-To", async () => {
    const first = await deliver("clove", "Plans", { messageId: "<a@example.com>" });
    const reply = await deliver("clove", "Totally different", { inReplyTo: "<a@example.com>" });
    expect(reply.threadId).toBe(first.threadId);
  });

  it("doesn't merge unrelated mail that shares a subject", async () => {
    const a = await deliver("clove", "Your weekly digest");
    const b = await deliver("clove", "Your weekly digest");
    expect(a.threadId).not.toBe(b.threadId);
  });
});

describe("mailbox isolation", () => {
  it("never shows or deletes another user's thread, even with the same subject", async () => {
    const mine = await deliver("clove", "Re: shared subject");
    const theirs = await deliver("ari", "Re: shared subject");

    expect((await call(ari, `/api/threads/${mine.threadId}`)).status).toBe(404);
    expect((await call(ari, `/api/threads/${mine.threadId}`, { method: "DELETE" })).status).toBe(404);
    expect((await call(ari, `/api/threads/${theirs.threadId}`, { method: "DELETE" })).status).toBe(200);

    const thread = (await (await call(clove, `/api/threads/${mine.threadId}`)).json()) as Thread;
    expect(thread.messages).toHaveLength(1);
  });

  it("lists only the caller's mail and filters by domain", async () => {
    await deliver("ari", "for ari only");
    const page = (await (await call(clove, "/api/threads?folder=inbox")).json()) as Page<ThreadSummary>;
    expect(page.items.some((t) => t.subject === "for ari only")).toBe(false);

    const win = (await (await call(clove, "/api/threads?folder=inbox&mailbox=@doughmination.win")).json()) as Page<ThreadSummary>;
    expect(win.items).toHaveLength(0);
  });
});

describe("attachments", () => {
  async function upload(token: string, name: string, type: string, body: string) {
    const form = new FormData();
    form.set("file", new File([body], name, { type }));
    const res = await call(token, "/api/uploads", { method: "POST", body: form });
    return (await res.json()) as { id: string };
  }

  it("serves HTML as a sandboxed download, never as a page", async () => {
    const { id } = await upload(clove, "x.html", "text/html", "<script>alert(1)</script>");
    const res = await call(clove, `/api/attachments/${id}?inline=1`);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    await res.arrayBuffer();
  });

  it("shows images inline when asked", async () => {
    const { id } = await upload(clove, "a.png", "image/png", "png-bytes");
    const res = await call(clove, `/api/attachments/${id}?inline=1`);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-disposition")).toMatch(/^inline;/);
    await res.arrayBuffer();
  });

  it("won't hand one user's attachment to another", async () => {
    const { id } = await upload(clove, "secret.pdf", "application/pdf", "secret");
    expect((await call(ari, `/api/attachments/${id}`)).status).toBe(404);

    const draft = await deliver("ari", "draft holder");
    await expect(setMessageAttachments(env, "ari", draft.id, [id])).rejects.toThrow("Unknown attachment");
  });
});
