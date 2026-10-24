// One-off copy of the old inbox's mail (the `emails` table of email-db) into
// the new schema. Run through worker.ts; see README.md in this folder.
//
// Safe to run more than once: messages, threads and attachments keep ids
// derived from the old rows, so anything already copied is skipped.

import { Resend } from "resend";
import { bareAddress, baseSubject } from "../../src/worker/lib/address";
import { snippetOf } from "../../src/worker/services/messages";

export interface MigrateEnv {
  OLD_DB: D1Database;
  DB: D1Database;
  BUCKET: R2Bucket;
  /** Optional: lets inbound attachments the old inbox never stored be fetched again from Resend. */
  RESEND_API_KEY?: string;
}

type OldEmail = {
  seq: number;
  id: string;
  owner: string;
  folder: "inbox" | "sent" | "drafts";
  from_addr: string;
  to_addrs: string;
  subject: string;
  html: string | null;
  text: string | null;
  received_at: string;
  attachments: string;
  direction: "inbound" | "outbound";
  status: "sent" | "draft";
  message_id: string | null;
  in_reply_to: string | null;
  refs: string | null;
  thread_key: string;
  read: number;
};

type OldAttachment = { id?: string; filename?: string; contentType?: string; size?: number; contentId?: string | null };

export interface Report {
  dryRun: boolean;
  oldEmails: number;
  copied: number;
  alreadyCopied: number;
  /** Mail for users who haven't signed in to the new inbox yet. They sign in, you run this again. */
  waitingForSignIn: Record<string, number>;
  attachments: { fromOldDb: number; fromResend: number; unavailable: string[] };
}

async function threadIdFor(owner: string, threadKey: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${owner}\n${threadKey}`));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `v1-${hex.slice(0, 32)}`;
}

async function oldBytes(env: MigrateEnv, attachmentId: string): Promise<Uint8Array | null> {
  const { results } = await env.OLD_DB.prepare(
    "SELECT data FROM attachment_chunks WHERE attachment_id = ? ORDER BY idx",
  )
    .bind(attachmentId)
    .all<{ data: ArrayBuffer | number[] }>();
  if (!results.length) return null;
  const parts = results.map((r) => new Uint8Array(r.data));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** What Resend still has for a received email, if anything. */
async function resendAttachments(env: MigrateEnv, emailId: string) {
  if (!env.RESEND_API_KEY) return [];
  const { data } = await new Resend(env.RESEND_API_KEY).emails.receiving.attachments.list({ emailId, limit: 100 });
  return data?.data ?? [];
}

export async function migrate(env: MigrateEnv, { apply }: { apply: boolean }): Promise<Report> {
  const report: Report = {
    dryRun: !apply,
    oldEmails: 0,
    copied: 0,
    alreadyCopied: 0,
    waitingForSignIn: {},
    attachments: { fromOldDb: 0, fromResend: 0, unavailable: [] },
  };

  const { results: users } = await env.DB.prepare("SELECT username FROM users").all<{ username: string }>();
  const signedIn = new Set(users.map((u) => u.username.toLowerCase()));

  let after = 0;
  for (;;) {
    const { results: page } = await env.OLD_DB.prepare("SELECT * FROM emails WHERE seq > ? ORDER BY seq LIMIT 25")
      .bind(after)
      .all<OldEmail>();
    if (!page.length) break;
    after = page[page.length - 1]!.seq;

    for (const e of page) {
      report.oldEmails++;
      const owner = e.owner.toLowerCase();
      if (!signedIn.has(owner)) {
        report.waitingForSignIn[owner] = (report.waitingForSignIn[owner] ?? 0) + 1;
        continue;
      }
      if (await env.DB.prepare("SELECT 1 FROM messages WHERE id = ?").bind(e.id).first()) {
        report.alreadyCopied++;
        continue;
      }

      const to = JSON.parse(e.to_addrs) as string[];
      const sentAt = Date.parse(e.received_at) || 0;
      const threadId = await threadIdFor(owner, e.thread_key);
      const counterpart = e.thread_key.split("::")[1] || bareAddress(e.direction === "inbound" ? e.from_addr : to[0]);
      const mailbox = bareAddress(e.direction === "inbound" ? to[0] : e.from_addr);
      const writes: D1PreparedStatement[] = [
        env.DB.prepare(
          "INSERT INTO threads (id, owner, subject, counterpart, last_at) VALUES (?, ?, ?, ?, ?) " +
            "ON CONFLICT (id) DO UPDATE SET last_at = MAX(last_at, excluded.last_at)",
        ).bind(threadId, owner, baseSubject(e.subject), counterpart, sentAt),
        env.DB.prepare(
          "INSERT OR IGNORE INTO messages (id, owner, thread_id, folder, mailbox, resend_id, message_id, in_reply_to, " +
            "refs, from_addr, to_addrs, cc_addrs, subject, snippet, html, text, sent_at, read) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?)",
        ).bind(
          e.id,
          owner,
          threadId,
          e.folder,
          mailbox,
          e.status === "draft" ? null : e.id,
          e.message_id,
          e.in_reply_to,
          e.refs,
          e.from_addr,
          e.to_addrs,
          e.subject,
          snippetOf(e.text, e.html),
          e.html,
          e.text,
          sentAt,
          e.read,
        ),
      ];

      // The old inbox listed attachments it often never stored the bytes of.
      // Take them from the old DB when they're there, else ask Resend again.
      const listed = (JSON.parse(e.attachments) as OldAttachment[]).filter((a) => a.id);
      const fromResend = listed.length && e.direction === "inbound" ? await resendAttachments(env, e.id) : [];
      for (const [i, a] of listed.entries()) {
        const id = a.id!;
        const key = `inbox/v1/${id}`;
        const filename = a.filename || "attachment";
        const contentType = a.contentType || "application/octet-stream";

        let body = await oldBytes(env, id);
        let source: "fromOldDb" | "fromResend" = "fromOldDb";
        if (!body) {
          const match =
            fromResend.find((r) => a.contentId && r.content_id?.replace(/^<|>$/g, "") === a.contentId) ??
            fromResend.find((r) => r.filename === a.filename) ??
            fromResend[i];
          const res = match ? await fetch(match.download_url) : null;
          body = res?.ok ? await res.arrayBuffer().then((b) => new Uint8Array(b)) : null;
          source = "fromResend";
        }
        if (!body) {
          report.attachments.unavailable.push(`${filename} (in "${e.subject}")`);
          continue;
        }
        report.attachments[source]++;

        if (apply && !(await env.BUCKET.head(key))) {
          await env.BUCKET.put(key, body, { httpMetadata: { contentType } });
        }
        writes.push(
          env.DB.prepare(
            "INSERT OR IGNORE INTO attachments (id, owner, message_id, r2_key, filename, content_type, size, " +
              "content_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          ).bind(id, owner, e.id, key, filename, contentType, body.byteLength, a.contentId ?? null, sentAt),
        );
      }

      // Thread, message and its attachments land together or not at all.
      if (apply) await env.DB.batch(writes);
      report.copied++;
    }
  }
  return report;
}
