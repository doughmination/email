import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { sessionKey } from "../src/worker/services/sessions";
import type { Page, Thread, ThreadSummary } from "../src/shared/types";
import { setMessageAttachments } from "../src/worker/services/attachments";
import { formatAddress } from "../src/worker/lib/address";
import { displayName, recordLogin, routeRecipients } from "../src/worker/services/directory";
import { BIN_RETENTION_MS, insertMessage, purgeBin, resolveThread } from "../src/worker/services/messages";

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
    .bind(await sessionKey(token), JSON.stringify(session), ts + 3600)
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

describe("starred", () => {
  const list = async (folder: string) =>
    ((await (await call(clove, `/api/threads?folder=${folder}`)).json()) as Page<ThreadSummary>).items;
  const star = (token: string, threadId: string, starred: boolean) =>
    call(token, `/api/threads/${threadId}/star`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ starred }),
    });

  it("lists starred threads and flags them everywhere", async () => {
    const { threadId } = await deliver("clove", "Star me");
    expect((await list("starred")).map((t) => t.id)).not.toContain(threadId);

    expect((await star(clove, threadId, true)).status).toBe(200);
    expect((await list("starred")).map((t) => t.id)).toContain(threadId);
    expect((await list("inbox")).find((t) => t.id === threadId)?.starred).toBe(true);
    const thread = (await (await call(clove, `/api/threads/${threadId}`)).json()) as Thread;
    expect(thread.starred).toBe(true);

    await star(clove, threadId, false);
    expect((await list("starred")).map((t) => t.id)).not.toContain(threadId);
  });

  it("hides binned threads from Starred but keeps the star", async () => {
    const { threadId } = await deliver("clove", "Starred then binned");
    await star(clove, threadId, true);
    await call(clove, `/api/threads/${threadId}`, { method: "DELETE" });
    expect((await list("starred")).map((t) => t.id)).not.toContain(threadId);

    await call(clove, `/api/threads/${threadId}/restore`, { method: "POST" });
    expect((await list("starred")).map((t) => t.id)).toContain(threadId);
  });

  it("can't star someone else's thread", async () => {
    const { threadId } = await deliver("clove", "Not yours");
    expect((await star(ari, threadId, true)).status).toBe(404);
  });
});

describe("bin", () => {
  const list = async (folder: string) =>
    ((await (await call(clove, `/api/threads?folder=${folder}`)).json()) as Page<ThreadSummary>).items.map((t) => t.id);

  it("moves a deleted thread to the Bin and back", async () => {
    const { threadId } = await deliver("clove", "Bin me");
    expect((await call(clove, `/api/threads/${threadId}`, { method: "DELETE" })).status).toBe(200);
    expect(await list("inbox")).not.toContain(threadId);
    expect(await list("bin")).toContain(threadId);
    expect((await call(clove, `/api/threads/${threadId}`)).status).toBe(404);
    expect((await call(clove, `/api/threads/${threadId}?bin=1`)).status).toBe(200);

    expect((await call(clove, `/api/threads/${threadId}/restore`, { method: "POST" })).status).toBe(200);
    expect(await list("inbox")).toContain(threadId);
    expect(await list("bin")).not.toContain(threadId);
  });

  it("doesn't count binned mail as unread", async () => {
    const { threadId } = await deliver("clove", "Unread then binned");
    const unread = async () =>
      ((await (await call(clove, "/api/unread")).json()) as { unread: Record<string, number> }).unread["clove@doughmination.gay"] ?? 0;
    const before = await unread();
    await call(clove, `/api/threads/${threadId}`, { method: "DELETE" });
    expect(await unread()).toBe(before - 1);
  });

  it("deletes forever only what's in the Bin", async () => {
    const first = await deliver("clove", "Forever", { messageId: "<forever@example.com>" });
    await call(clove, `/api/threads/${first.threadId}`, { method: "DELETE" });
    // A reply arrives after the thread was binned; it stays in the inbox.
    const reply = await deliver("clove", "Re: Forever", { inReplyTo: "<forever@example.com>" });
    expect(reply.threadId).toBe(first.threadId);

    const res = await call(clove, `/api/threads/${first.threadId}?forever=1`, { method: "DELETE" });
    expect(await res.json()).toEqual({ count: 1 });
    const thread = (await (await call(clove, `/api/threads/${first.threadId}`)).json()) as Thread;
    expect(thread.messages.map((m) => m.id)).toEqual([reply.id]);
  });

  it("purges what's been in the Bin over 30 days", async () => {
    const old = await deliver("clove", "Old bin");
    const recent = await deliver("clove", "Recent bin");
    await env.DB.prepare("UPDATE messages SET trashed_at = ? WHERE id = ?").bind(Date.now() - BIN_RETENTION_MS - 1, old.id).run();
    await env.DB.prepare("UPDATE messages SET trashed_at = ? WHERE id = ?").bind(Date.now(), recent.id).run();
    await purgeBin(env);
    expect(await list("bin")).not.toContain(old.threadId);
    expect(await list("bin")).toContain(recent.threadId);
  });
});

describe("display names", () => {
  it("keeps a name set in Settings over the SSO's", async () => {
    await recordLogin(env, { username: "noor", sub: "sub-noor", name: "Noor From SSO", refreshToken: null, idToken: "x" });
    expect(await displayName(env, "noor")).toBe("Noor From SSO");
    await env.DB.prepare("UPDATE users SET display_name = 'Noor' WHERE username = 'noor'").run();
    await recordLogin(env, { username: "noor", sub: "sub-noor", name: "Noor From SSO", refreshToken: null, idToken: "x" });
    expect(await displayName(env, "noor")).toBe("Noor");
  });

  it("lets a user change their name", async () => {
    const res = await call(clove, "/api/me", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "  Clove Twilight " }),
    });
    expect(await res.json()).toEqual({ name: "Clove Twilight" });
    expect(((await (await call(clove, "/api/me")).json()) as { name: string }).name).toBe("Clove Twilight");
  });

  it("formats a From header without letting the name break out", () => {
    expect(formatAddress("Clove Twilight", "clove@x.y")).toBe('"Clove Twilight" <clove@x.y>');
    expect(formatAddress('Evil" <a@b.c>\r\nBcc: x', "clove@x.y")).toBe('"Evil a@b.c Bcc: x" <clove@x.y>');
    expect(formatAddress("", "clove@x.y")).toBe("clove@x.y");
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
