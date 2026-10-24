import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, type MigrateEnv } from "../scripts/migrate-v1/migrate";
import { getThread } from "../src/worker/services/messages";

// The old tables don't clash with the new ones, so the test DB plays both.
const both: MigrateEnv = { OLD_DB: env.DB, DB: env.DB, BUCKET: env.BUCKET };

const oldEmail = (o: {
  id: string;
  owner: string;
  folder: "inbox" | "sent";
  from: string;
  to: string;
  subject: string;
  at: string;
  threadKey: string;
  attachments?: unknown[];
  read?: number;
}) =>
  env.DB.prepare(
    "INSERT INTO emails (id, owner, folder, from_addr, to_addrs, subject, html, text, received_at, attachments, " +
      "direction, status, message_id, in_reply_to, refs, thread_key, read) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sent', NULL, NULL, NULL, ?, ?)",
  ).bind(
    o.id,
    o.owner,
    o.folder,
    o.from,
    JSON.stringify([o.to]),
    o.subject,
    `<p>${o.subject}</p>`,
    o.subject,
    o.at,
    JSON.stringify(o.attachments ?? []),
    o.folder === "inbox" ? "inbound" : "outbound",
    o.threadKey,
    o.read ?? 1,
  );

beforeAll(async () => {
  await env.DB.batch([
    env.DB.prepare(
      "CREATE TABLE emails (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, owner TEXT NOT NULL, " +
        "folder TEXT NOT NULL, from_addr TEXT NOT NULL, to_addrs TEXT NOT NULL, subject TEXT NOT NULL, html TEXT, " +
        "text TEXT, received_at TEXT NOT NULL, attachments TEXT NOT NULL, direction TEXT NOT NULL, status TEXT NOT NULL, " +
        "message_id TEXT, in_reply_to TEXT, refs TEXT, thread_key TEXT NOT NULL, read INTEGER NOT NULL DEFAULT 0)",
    ),
    env.DB.prepare(
      "CREATE TABLE attachment_chunks (attachment_id TEXT NOT NULL, idx INTEGER NOT NULL, data BLOB NOT NULL, " +
        "PRIMARY KEY (attachment_id, idx))",
    ),
    env.DB.prepare(
      "INSERT INTO users (username, sub, is_admin, created_at, last_login_at) VALUES ('clove', 'sub-clove', 1, 0, 0)",
    ),
    oldEmail({
      id: "11111111-1111-4111-8111-111111111111",
      owner: "clove",
      folder: "inbox",
      from: "Ari <ari@example.com>",
      to: "clove@doughmination.gay",
      subject: "Plans",
      at: "2026-09-01T10:00:00.000Z",
      threadKey: "plans::ari@example.com",
      read: 0,
      attachments: [
        { id: "aaaaaaaa-0000-4000-8000-000000000001", filename: "map.txt", contentType: "text/plain", size: 5, contentId: null },
        { id: "aaaaaaaa-0000-4000-8000-000000000002", filename: "lost.pdf", contentType: "application/pdf", size: 0 },
      ],
    }),
    oldEmail({
      id: "22222222-2222-4222-8222-222222222222",
      owner: "clove",
      folder: "sent",
      from: "clove@doughmination.gay",
      to: "ari@example.com",
      subject: "Re: Plans",
      at: "2026-09-01T11:00:00.000Z",
      threadKey: "plans::ari@example.com",
    }),
    oldEmail({
      id: "33333333-3333-4333-8333-333333333333",
      owner: "ari",
      folder: "inbox",
      from: "someone@example.com",
      to: "ari@doughmination.gay",
      subject: "For Ari",
      at: "2026-09-02T10:00:00.000Z",
      threadKey: "for ari::someone@example.com",
    }),
    // Only the first attachment's bytes were ever stored, as with the real data.
    env.DB.prepare("INSERT INTO attachment_chunks (attachment_id, idx, data) VALUES (?, 0, ?)").bind(
      "aaaaaaaa-0000-4000-8000-000000000001",
      new TextEncoder().encode("hello"),
    ),
  ]);
});

describe("migrate v1", () => {
  it("writes nothing on a dry run", async () => {
    const report = await migrate(both, { apply: false });
    expect(report).toMatchObject({ dryRun: true, oldEmails: 3, copied: 2, waitingForSignIn: { ari: 1 } });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM messages").first("n")).toBe(0);
  });

  it("copies signed-in users' mail into threads, with attachments in R2", async () => {
    const report = await migrate(both, { apply: true });
    expect(report).toMatchObject({ copied: 2, alreadyCopied: 0, waitingForSignIn: { ari: 1 } });
    expect(report.attachments).toEqual({ fromOldDb: 1, fromResend: 0, unavailable: ['lost.pdf (in "Plans")'] });

    const { thread_id } = (await env.DB.prepare("SELECT thread_id FROM messages WHERE id = ?")
      .bind("11111111-1111-4111-8111-111111111111")
      .first<{ thread_id: string }>())!;
    const thread = (await getThread(env, "clove", thread_id))!;
    expect(thread.messages.map((m) => [m.folder, m.subject, m.read])).toEqual([
      ["inbox", "Plans", false],
      ["sent", "Re: Plans", true],
    ]);
    expect(thread.messages[0]!.mailbox).toBe("clove@doughmination.gay");
    expect(thread.messages[0]!.attachments.map((a) => a.filename)).toEqual(["map.txt"]);

    const obj = await env.BUCKET.get("inbox/v1/aaaaaaaa-0000-4000-8000-000000000001");
    expect(await obj?.text()).toBe("hello");
  });

  it("is safe to run again, and picks up users who've since signed in", async () => {
    await env.DB.prepare(
      "INSERT INTO users (username, sub, is_admin, created_at, last_login_at) VALUES ('ari', 'sub-ari', 0, 0, 0)",
    ).run();
    const report = await migrate(both, { apply: true });
    expect(report).toMatchObject({ copied: 1, alreadyCopied: 2, waitingForSignIn: {} });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM messages").first("n")).toBe(3);
  });
});
