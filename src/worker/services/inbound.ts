import { bareAddress } from "../lib/address";
import { cleanContentId, inboundKey, insertAttachmentStatement } from "./attachments";
import { routeRecipients } from "./directory";
import { insertMessageStatement, resolveThread } from "./messages";
import { notifyUser } from "./push";
import { resend } from "./resend";

function header(headers: Record<string, string> | null | undefined, name: string): string | null {
  if (!headers) return null;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key ? (headers[key] ?? null) : null;
}

/**
 * Stores a received email in every mailbox it's addressed to. Safe to run
 * again for the same email (Resend retries webhooks): copies already stored
 * are skipped and attachment objects are written to fixed keys.
 */
export async function receiveEmail(env: Env, emailId: string): Promise<{ stored: number }> {
  const client = resend(env);
  // 'cid' keeps inline images as attachments instead of inlining them into the
  // HTML as data: URIs, which could push a row past D1's 2 MB limit.
  const { data: email, error } = await client.emails.receiving.get(emailId, { html_format: "cid" });
  if (error || !email) throw new Error(`Could not fetch received email ${emailId}: ${error?.message}`);

  // received_for is the envelope, so it includes Bcc'd addresses here.
  const recipients = email.received_for?.length
    ? email.received_for
    : [...email.to, ...(email.cc ?? []), ...(email.bcc ?? [])];
  const owners = await routeRecipients(env, recipients);

  const { results: existing } = await env.DB.prepare("SELECT owner FROM messages WHERE resend_id = ?")
    .bind(emailId)
    .all<{ owner: string }>();
  for (const { owner } of existing) owners.delete(owner.toLowerCase());
  if (!owners.size) return { stored: 0 };

  const { data: list, error: listError } = await client.emails.receiving.attachments.list({ emailId, limit: 100 });
  if (listError) throw new Error(`Could not list attachments for ${emailId}: ${listError.message}`);
  const files = list?.data ?? [];

  await Promise.all(
    files.map(async (a) => {
      const key = inboundKey(emailId, a.id);
      if (await env.BUCKET.head(key)) return;
      const res = await fetch(a.download_url);
      if (!res.ok || !res.body) throw new Error(`Attachment download failed (${res.status}) for ${a.id}`);
      await env.BUCKET.put(key, res.body, { httpMetadata: { contentType: a.content_type } });
    }),
  );

  const sentAt = Date.parse(email.created_at) || Date.now();
  const inReplyTo = header(email.headers, "in-reply-to");
  const refs = header(email.headers, "references");
  let stored = 0;

  for (const [owner, mailbox] of owners) {
    const threadId = await resolveThread(env, owner, {
      inReplyTo,
      refs,
      subject: email.subject ?? "",
      counterpart: bareAddress(email.from),
      sentAt,
    });
    const id = crypto.randomUUID();
    // One batch (one transaction), so a crash can't leave the message stored
    // without its attachments for a retry to then skip. If this copy already
    // exists the message insert is a no-op and so are the attachment inserts.
    const [message] = await env.DB.batch([
      insertMessageStatement(env, threadId, {
        id,
        owner,
        folder: "inbox",
        mailbox,
        resend_id: emailId,
        message_id: email.message_id || null,
        in_reply_to: inReplyTo,
        refs,
        from_addr: email.from,
        to_addrs: JSON.stringify(email.to),
        cc_addrs: JSON.stringify(email.cc ?? []),
        subject: email.subject || "(no subject)",
        html: email.html,
        text: email.text,
        sent_at: sentAt,
        read: false,
      }),
      ...files.map((a) =>
        insertAttachmentStatement(env, {
          id: crypto.randomUUID(),
          owner,
          messageId: id,
          r2Key: inboundKey(emailId, a.id),
          filename: a.filename || "attachment",
          contentType: a.content_type || "application/octet-stream",
          size: a.size,
          contentId: cleanContentId(a.content_id),
        }),
      ),
    ]);
    if (!message?.meta.changes) continue;
    stored++;

    try {
      await notifyUser(env, owner, {
        title: `New email from ${email.from}`,
        body: email.subject || "(no subject)",
        url: `/inbox/${threadId}`,
        tag: id,
      });
    } catch (err) {
      console.error("Push notification failed", err);
    }
  }
  return { stored };
}
