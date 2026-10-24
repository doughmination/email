import { env, exports } from "cloudflare:workers";
import { Webhook } from "standardwebhooks";
import { beforeAll, describe, expect, it } from "vitest";
import type { Thread } from "../src/shared/types";
import { insertMessage, resolveThread } from "../src/worker/services/messages";

const ORIGIN = "https://mail.test";
const SENT_RESEND_ID = "5f2b1c3e-0000-4000-8000-000000000001";
let token: string;
let threadId: string;

/** Delivers `event` the way Resend does: signed with the webhook secret. */
function webhook(event: unknown) {
  const id = `msg_${crypto.randomUUID()}`;
  const now = new Date();
  const body = JSON.stringify(event);
  const signature = new Webhook(env.RESEND_WEBHOOK_SECRET).sign(id, now, body);
  return exports.default.fetch(
    new Request(`${ORIGIN}/webhook/inbound`, {
      method: "POST",
      headers: {
        "svix-id": id,
        "svix-timestamp": String(Math.floor(now.getTime() / 1000)),
        "svix-signature": signature,
        "content-type": "application/json",
      },
      body,
    }),
  );
}

const bounced = (emailId: string) => ({
  type: "email.bounced",
  created_at: new Date().toISOString(),
  data: {
    created_at: new Date().toISOString(),
    email_id: emailId,
    message_id: "<x@doughmination.gay>",
    from: "clove@doughmination.gay",
    to: ["nobody@example.com"],
    subject: "Hello there",
    bounce: { type: "Permanent", subType: "General", message: "550 5.1.1 User unknown" },
  },
});

beforeAll(async () => {
  const now = Date.now();
  await env.DB.prepare("INSERT INTO users (username, sub, is_admin, created_at, last_login_at) VALUES ('clove', 'sub-clove', 0, ?, ?)")
    .bind(now, now)
    .run();
  token = crypto.randomUUID();
  const ts = Math.floor(now / 1000);
  await env.DB.prepare("INSERT INTO sessions (token, data, expires_at) VALUES (?, ?, ?)")
    .bind(
      token,
      JSON.stringify({ username: "clove", sub: "sub-clove", refreshToken: null, idToken: null, createdAt: ts, verifiedAt: ts, checkedAt: ts }),
      ts + 3600,
    )
    .run();

  threadId = await resolveThread(env, "clove", {
    inReplyTo: null,
    refs: null,
    subject: "Hello there",
    counterpart: "nobody@example.com",
    sentAt: now,
  });
  await insertMessage(env, threadId, {
    id: crypto.randomUUID(),
    owner: "clove",
    folder: "sent",
    mailbox: "clove@doughmination.gay",
    resend_id: SENT_RESEND_ID,
    message_id: "<x@doughmination.gay>",
    in_reply_to: null,
    refs: null,
    from_addr: "clove@doughmination.gay",
    to_addrs: JSON.stringify(["nobody@example.com"]),
    cc_addrs: "[]",
    subject: "Hello there",
    html: null,
    text: "hi",
    sent_at: now,
    read: true,
  });
});

describe("email.bounced", () => {
  it("puts an unread notice in the inbox, in the same conversation", async () => {
    const res = await webhook(bounced(SENT_RESEND_ID));
    expect(await res.json()).toEqual({ ok: true, stored: 1 });

    const thread = (await (
      await exports.default.fetch(new Request(`${ORIGIN}/api/threads/${threadId}`, { headers: { cookie: `session=${token}` } }))
    ).json()) as Thread;
    expect(thread.messages).toHaveLength(2);
    const notice = thread.messages[1]!;
    expect(notice).toMatchObject({
      folder: "inbox",
      read: false,
      from: "Mail Delivery <mailer-daemon@doughmination.gay>",
      subject: "Undelivered: Hello there",
    });
    expect(notice.text).toContain("550 5.1.1 User unknown");
    expect(notice.text).toContain("nobody@example.com");
  });

  it("doesn't add a second notice when Resend retries", async () => {
    expect(await (await webhook(bounced(SENT_RESEND_ID))).json()).toEqual({ ok: true, stored: 0 });
  });

  it("ignores bounces for mail this inbox didn't send", async () => {
    expect(await (await webhook(bounced("not-ours"))).json()).toEqual({ ok: true, stored: 0 });
  });

  it("rejects unsigned events", async () => {
    const res = await exports.default.fetch(
      new Request(`${ORIGIN}/webhook/inbound`, { method: "POST", body: JSON.stringify(bounced(SENT_RESEND_ID)) }),
    );
    expect(res.status).toBe(401);
  });
});
