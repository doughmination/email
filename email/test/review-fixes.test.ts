import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { splitList } from "../src/web/lib/format";
import { insertAttachmentStatement } from "../src/worker/services/attachments";
import { AccountConflict, recordLogin } from "../src/worker/services/directory";

const ORIGIN = "https://mail.test";

async function session(username: string, sub: string): Promise<string> {
  const token = crypto.randomUUID();
  const ts = Math.floor(Date.now() / 1000);
  const data = { username, sub, refreshToken: null, idToken: null, createdAt: ts, verifiedAt: ts, checkedAt: ts };
  await env.DB.prepare("INSERT INTO sessions (token, data, expires_at) VALUES (?, ?, ?)")
    .bind(token, JSON.stringify(data), ts + 3600)
    .run();
  return token;
}

const me = (token: string) =>
  exports.default.fetch(new Request(`${ORIGIN}/api/me`, { headers: { cookie: `session=${token}` } }));

describe("sessions are tied to the SSO account, not just the username", () => {
  it("rejects a session whose sub no longer owns the username", async () => {
    await recordLogin(env, { username: "sam", sub: "sub-new", refreshToken: null, idToken: "x" });
    expect((await me(await session("sam", "sub-new"))).status).toBe(200);
    // A session left over from the previous holder of the name.
    expect((await me(await session("sam", "sub-old"))).status).toBe(401);
  });

  it("refuses a sign-in that would take over another account's username", async () => {
    await expect(
      recordLogin(env, { username: "sam", sub: "sub-someone-else", refreshToken: null, idToken: "x" }),
    ).rejects.toBeInstanceOf(AccountConflict);
    // The same account signing in again is fine.
    await recordLogin(env, { username: "sam", sub: "sub-new", refreshToken: null, idToken: "x" });
  });
});

describe("attachment inserts batched after a message", () => {
  it("insert nothing when the message doesn't exist", async () => {
    const res = await insertAttachmentStatement(env, {
      id: crypto.randomUUID(),
      owner: "sam",
      messageId: crypto.randomUUID(),
      r2Key: "inbox/x",
      filename: "a.txt",
      contentType: "text/plain",
      size: 1,
      contentId: null,
    }).run();
    expect(res.meta.changes).toBe(0);
  });

  it("still store unclaimed uploads", async () => {
    const res = await insertAttachmentStatement(env, {
      id: crypto.randomUUID(),
      owner: "sam",
      messageId: null,
      r2Key: "inbox/uploads/y",
      filename: "b.txt",
      contentType: "text/plain",
      size: 1,
      contentId: null,
    }).run();
    expect(res.meta.changes).toBe(1);
  });
});

describe("splitList", () => {
  it("splits on , ; and newlines but not inside quotes", () => {
    expect(splitList('"Doe, Jane" <jane@x.y>, bob@x.y;\n carol@x.y,,')).toEqual([
      '"Doe, Jane" <jane@x.y>',
      "bob@x.y",
      "carol@x.y",
    ]);
  });
});
