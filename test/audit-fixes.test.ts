import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { chunks } from "../src/worker/lib/chunk";
import { AttachmentsTooLarge, forResend, insertAttachmentStatement } from "../src/worker/services/attachments";
import { AccountConflict, ReservedUsername, getUser, recordLogin } from "../src/worker/services/directory";
import { emptyBin, insertMessage, resolveThread } from "../src/worker/services/messages";
import { pkceChallenge } from "../src/worker/services/oidc";
import { createSession, saveAppCode, sessionKey } from "../src/worker/services/sessions";

const ORIGIN = "https://mail.test";

const login = (username: string, sub: string) => recordLogin(env, { username, sub, refreshToken: null, idToken: "x" });

function call(path: string, init: RequestInit = {}) {
  return exports.default.fetch(new Request(`${ORIGIN}${path}`, init));
}

async function storeMessage(owner: string, subject: string): Promise<{ id: string; threadId: string }> {
  const threadId = await resolveThread(env, owner, {
    inReplyTo: null,
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
    message_id: null,
    in_reply_to: null,
    refs: null,
    from_addr: "sender@example.com",
    to_addrs: "[]",
    cc_addrs: "[]",
    subject,
    html: null,
    text: "hi",
    sent_at: Date.now(),
    read: false,
  });
  return { id, threadId };
}

describe("sign-in identity", () => {
  // Runs first: ADMIN_USERS only makes a new account an admin while there's none.
  it("makes the bootstrap admin an admin when there's no admin yet", async () => {
    expect(await login("clove", "sub-clove")).toBe("clove");
    expect((await getUser(env, "clove"))?.isAdmin).toBe(true);
  });

  it("doesn't make a later holder of a bootstrap name an admin", async () => {
    await env.DB.prepare("DELETE FROM users WHERE username = 'clove'").run();
    await env.DB.prepare(
      "INSERT INTO users (username, sub, is_admin, created_at, last_login_at) VALUES ('ari', 'sub-ari', 1, 0, 0)",
    ).run();
    expect(await login("clove", "sub-impostor")).toBe("clove");
    expect((await getUser(env, "clove"))?.isAdmin).toBe(false);
  });

  it("keeps someone renamed on the SSO in their existing mailbox", async () => {
    await login("rosa", "sub-rosa");
    expect(await login("rosa-renamed", "sub-rosa")).toBe("rosa");
    expect(await getUser(env, "rosa-renamed")).toBeNull();
  });

  it("refuses reserved names and names that are taken", async () => {
    await expect(login("postmaster", "sub-pm")).rejects.toBeInstanceOf(ReservedUsername);
    await expect(login("rosa", "sub-not-rosa")).rejects.toBeInstanceOf(AccountConflict);
  });
});

describe("sessions", () => {
  it("are stored under a hash, not the token itself", async () => {
    const token = await createSession(env, { username: "rosa", sub: "sub-rosa", refreshToken: null, idToken: "x" });
    const raw = await env.DB.prepare("SELECT 1 FROM sessions WHERE token = ?").bind(token).first();
    const hashed = await env.DB.prepare("SELECT 1 FROM sessions WHERE token = ?").bind(await sessionKey(token)).first();
    expect(raw).toBeNull();
    expect(hashed).not.toBeNull();
  });
});

describe("app sign-in", () => {
  const verifier = "v".repeat(43);
  const swap = (code: string, v: string) =>
    call("/auth/app/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, verifier: v }),
    });

  it("swaps a code for a token only with the right verifier, and only once", async () => {
    const token = await createSession(env, { username: "rosa", sub: "sub-rosa", refreshToken: null, idToken: "x" });
    const challenge = await pkceChallenge(verifier);

    expect((await swap(await saveAppCode(env, token, challenge), "w".repeat(43))).status).toBe(400);

    const code = await saveAppCode(env, token, challenge);
    const res = await swap(code, verifier);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { token: string }).token).toBe(token);
    expect((await swap(code, verifier)).status).toBe(400);
  });

  it("signs API calls in with the bearer token, and never falls back to the cookie", async () => {
    const token = await createSession(env, { username: "rosa", sub: "sub-rosa", refreshToken: null, idToken: "x" });
    expect((await call("/api/me", { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
    const mixed = await call("/api/me", { headers: { authorization: "Bearer nope", cookie: `session=${token}` } });
    expect(mixed.status).toBe(401);
    // No Origin header, as from the app: allowed, since a bearer token can't be forged cross-site.
    const patch = await call("/api/me", {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "Rosa" }),
    });
    expect(patch.status).toBe(200);
  });

  it("rejects a malformed challenge at the start", async () => {
    expect((await call("/auth/login?app=short")).status).toBe(400);
  });
});

describe("request limits", () => {
  const authed = async () => ({
    authorization: `Bearer ${await createSession(env, { username: "rosa", sub: "sub-rosa", refreshToken: null, idToken: "x" })}`,
    "content-type": "application/json",
  });

  it("refuses a garbage list cursor instead of failing", async () => {
    expect((await call("/api/threads?cursor=abc.def", { headers: await authed() })).status).toBe(400);
  });

  it("only takes https push endpoints, and at most 20 devices", async () => {
    const headers = await authed();
    const subscribe = (endpoint: string) =>
      call("/api/push/subscribe", {
        method: "POST",
        headers,
        body: JSON.stringify({ endpoint, keys: { p256dh: "p", auth: "a" } }),
      });
    expect((await subscribe("http://push.example/x")).status).toBe(400);
    for (let i = 0; i < 20; i++) expect((await subscribe(`https://push.example/${i}`)).status).toBe(200);
    expect((await subscribe("https://push.example/20")).status).toBe(400);
    // Re-subscribing an existing device still works at the cap.
    expect((await subscribe("https://push.example/3")).status).toBe(200);
  });

  it("refuses to send more attachment bytes than Resend takes, before reading any", async () => {
    const { id } = await storeMessage("rosa", "big");
    for (const n of [1, 2]) {
      await insertAttachmentStatement(env, {
        id: crypto.randomUUID(),
        owner: "rosa",
        messageId: id,
        r2Key: `inbox/missing/${n}`,
        filename: `${n}.bin`,
        contentType: "application/octet-stream",
        size: 20 * 1024 * 1024,
        contentId: null,
      }).run();
    }
    await expect(forResend(env, "rosa", id)).rejects.toBeInstanceOf(AttachmentsTooLarge);
  });
});

describe("bulk deletes", () => {
  it("splits IN lists under D1's 100-parameter limit", () => {
    const parts = chunks(Array.from({ length: 250 }, (_, i) => i));
    expect(parts.map((p) => p.length)).toEqual([90, 90, 70]);
  });

  it("empties a Bin of more threads than one statement can name", async () => {
    for (let i = 0; i < 150; i++) await storeMessage("rosa", `subject ${i}`);
    await env.DB.prepare("UPDATE messages SET trashed_at = 1 WHERE owner = 'rosa'").run();
    expect(await emptyBin(env, "rosa")).toBeGreaterThanOrEqual(150);
    const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM threads WHERE owner = 'rosa'").first<{ n: number }>();
    expect(left?.n).toBe(0);
  });
});
