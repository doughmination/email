import type { ComposeInput } from "../../shared/types";
import { bareAddress, formatAddress, splitAddress } from "../lib/address";
import { AttachmentsTooLarge, MAX_MESSAGE_ATTACHMENT_BYTES, forResend, setMessageAttachments } from "./attachments";
import { displayName, ownedAddress } from "./directory";
import { ancestry, getMessageRow, insertMessage, resolveThread, snippetOf } from "./messages";
import { resend } from "./resend";

/** A problem with what the user asked for; shown to them as-is. */
export class ComposeError extends Error {}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function renderHtml(text: string): string {
  const body = text
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `<div style="font-family: sans-serif; font-size: 14px; line-height: 1.5">${body}</div>`;
}

async function checkFrom(env: Env, user: string, from: string): Promise<string> {
  const owned = await ownedAddress(env, user, from);
  if (!owned) throw new ComposeError(`You can't send from ${bareAddress(from) || "that address"}.`);
  return owned;
}

/** Creates or updates a draft and returns its id. */
export async function saveDraft(env: Env, user: string, input: ComposeInput, draftId?: string): Promise<string> {
  const from = await checkFrom(env, user, input.from);
  const now = Date.now();
  const html = renderHtml(input.text);

  if (draftId) {
    const res = await env.DB.prepare(
      "UPDATE messages SET mailbox = ?, from_addr = ?, to_addrs = ?, cc_addrs = ?, bcc_addrs = ?, subject = ?, text = ?, " +
        "html = ?, snippet = ?, sent_at = ? WHERE id = ? AND owner = ? AND folder = 'drafts' AND trashed_at IS NULL",
    )
      .bind(
        from,
        from,
        JSON.stringify(input.to),
        JSON.stringify(input.cc),
        JSON.stringify(input.bcc),
        input.subject,
        input.text,
        html,
        snippetOf(input.text, null),
        now,
        draftId,
        user,
      )
      .run();
    if (!res.meta.changes) throw new ComposeError("That draft doesn't exist any more.");
    await setMessageAttachments(env, user, draftId, input.attachmentIds);
    return draftId;
  }

  const original = input.replyTo ? await getMessageRow(env, user, input.replyTo) : null;
  if (input.replyTo && !original) throw new ComposeError("The message you're replying to is gone.");

  const inReplyTo = original?.message_id ?? null;
  const refs = original ? ancestry(original.message_id, original.refs).reverse().join(" ") || null : null;
  const threadId = original
    ? original.thread_id
    : await resolveThread(env, user, {
        inReplyTo: null,
        refs: null,
        subject: input.subject,
        counterpart: bareAddress(input.to[0]),
        sentAt: now,
      });

  const id = crypto.randomUUID();
  await insertMessage(env, threadId, {
    id,
    owner: user,
    folder: "drafts",
    mailbox: from,
    resend_id: null,
    message_id: null,
    in_reply_to: inReplyTo,
    refs,
    from_addr: from,
    to_addrs: JSON.stringify(input.to),
    cc_addrs: JSON.stringify(input.cc),
    bcc_addrs: JSON.stringify(input.bcc),
    subject: input.subject,
    html,
    text: input.text,
    sent_at: now,
    read: true,
  });
  await setMessageAttachments(env, user, id, input.attachmentIds);
  return id;
}

/** Sends a saved draft through Resend and moves it to Sent. */
export async function sendDraft(env: Env, user: string, draftId: string): Promise<{ id: string; threadId: string }> {
  const draft = await getMessageRow(env, user, draftId);
  if (!draft || draft.folder !== "drafts" || draft.trashed_at !== null) throw new ComposeError("That draft doesn't exist any more.");

  const to = JSON.parse(draft.to_addrs) as string[];
  const cc = JSON.parse(draft.cc_addrs) as string[];
  const bcc = JSON.parse(draft.bcc_addrs) as string[];
  if (!to.length) throw new ComposeError("Add at least one recipient.");
  if (!draft.subject.trim()) throw new ComposeError("Add a subject.");

  // Ownership can change between saving and sending; check it again.
  const from = await checkFrom(env, user, draft.from_addr);
  // Drafts keep the bare address (it's what the From picker matches); the name goes on at send time.
  const fromHeader = formatAddress(await displayName(env, user), from);
  const domain = splitAddress(from)!.domain;
  // Recording our own Message-ID is what lets replies to it thread properly.
  const messageId = `<${crypto.randomUUID()}@${domain}>`;
  const headers: Record<string, string> = { "Message-ID": messageId };
  if (draft.in_reply_to) headers["In-Reply-To"] = draft.in_reply_to;
  if (draft.refs) headers["References"] = draft.refs;

  const attachments = await forResend(env, user, draftId).catch((err: unknown) => {
    if (!(err instanceof AttachmentsTooLarge)) throw err;
    throw new ComposeError(
      `Attachments can be up to ${MAX_MESSAGE_ATTACHMENT_BYTES / 1024 / 1024} MB in total. It's saved in Drafts.`,
    );
  });
  const { data, error } = await resend(env).emails.send(
    {
      from: fromHeader,
      to,
      cc: cc.length ? cc : undefined,
      bcc: bcc.length ? bcc : undefined,
      subject: draft.subject,
      html: draft.html ?? renderHtml(draft.text ?? ""),
      text: draft.text ?? undefined,
      headers,
      attachments: attachments.length ? attachments : undefined,
    },
    // sent_at moves on every save, so an edited retry isn't mistaken for a duplicate.
    { idempotencyKey: `send-${draftId}-${draft.sent_at}` },
  );
  if (error || !data) throw new ComposeError(error?.message ?? "Resend didn't accept the message.");

  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE messages SET folder = 'sent', from_addr = ?, resend_id = ?, message_id = ?, sent_at = ?, read = 1 " +
        "WHERE id = ?",
    ).bind(fromHeader, data.id, messageId, now, draftId),
    env.DB.prepare("UPDATE threads SET last_at = MAX(last_at, ?) WHERE id = ?").bind(now, draft.thread_id),
  ]);
  return { id: draftId, threadId: draft.thread_id };
}
