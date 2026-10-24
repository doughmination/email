import type { AttachmentInfo, Folder, Message, Page, Thread, ThreadSummary } from "../../shared/types";
import { baseSubject, isReplySubject } from "../lib/address";
import { purgeObjects } from "./attachments";

const FALLBACK_THREAD_WINDOW_MS = 1000 * 60 * 60 * 24 * 30;

type MessageRow = {
  id: string;
  owner: string;
  thread_id: string;
  folder: Folder;
  mailbox: string;
  resend_id: string | null;
  message_id: string | null;
  in_reply_to: string | null;
  refs: string | null;
  from_addr: string;
  to_addrs: string;
  cc_addrs: string;
  bcc_addrs: string;
  subject: string;
  snippet: string;
  html: string | null;
  text: string | null;
  sent_at: number;
  read: number;
};

type AttachmentRow = {
  id: string;
  message_id: string;
  filename: string;
  content_type: string;
  size: number;
  content_id: string | null;
};

export type NewMessage = Omit<MessageRow, "read" | "snippet" | "thread_id" | "bcc_addrs"> & {
  read: boolean;
  /** Defaults to none; only outgoing mail has a Bcc. */
  bcc_addrs?: string;
};

function toAttachment(row: AttachmentRow): AttachmentInfo {
  return {
    id: row.id,
    filename: row.filename,
    contentType: row.content_type,
    size: row.size,
    contentId: row.content_id,
  };
}

function toMessage(row: MessageRow, attachments: AttachmentInfo[]): Message {
  return {
    id: row.id,
    threadId: row.thread_id,
    folder: row.folder,
    mailbox: row.mailbox,
    from: row.from_addr,
    to: JSON.parse(row.to_addrs) as string[],
    cc: JSON.parse(row.cc_addrs) as string[],
    bcc: JSON.parse(row.bcc_addrs) as string[],
    subject: row.subject,
    snippet: row.snippet,
    html: row.html,
    text: row.text,
    sentAt: row.sent_at,
    read: row.read !== 0,
    attachments,
  };
}

export function snippetOf(text: string | null, html: string | null): string {
  const source =
    text ??
    (html ?? "")
      .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'");
  return source.replace(/\s+/g, " ").trim().slice(0, 200);
}

/** The Message-IDs a message points back at, nearest first. */
export function ancestry(inReplyTo: string | null, refs: string | null): string[] {
  const ids = [inReplyTo, ...(refs ?? "").split(/\s+/).reverse()];
  return [...new Set(ids.map((s) => s?.trim()).filter((s): s is string => Boolean(s)))];
}

/**
 * Finds the conversation a new message belongs to in `owner`'s mailbox, or
 * starts one. Headers first; for a "Re:" with no usable headers, fall back to
 * the same subject with the same person within the last 30 days.
 */
export async function resolveThread(
  env: Env,
  owner: string,
  msg: { inReplyTo: string | null; refs: string | null; subject: string; counterpart: string; sentAt: number },
): Promise<string> {
  const ids = ancestry(msg.inReplyTo, msg.refs).slice(0, 50);
  let threadId: string | null = null;

  if (ids.length) {
    const row = await env.DB.prepare(
      `SELECT thread_id FROM messages WHERE owner = ? AND message_id IN (${ids.map(() => "?").join(", ")}) ` +
        "ORDER BY sent_at DESC LIMIT 1",
    )
      .bind(owner, ...ids)
      .first<{ thread_id: string }>();
    threadId = row?.thread_id ?? null;
  }

  const subject = baseSubject(msg.subject);
  if (!threadId && isReplySubject(msg.subject) && subject) {
    const row = await env.DB.prepare(
      "SELECT id FROM threads WHERE owner = ? AND subject = ? AND counterpart = ? AND last_at > ? " +
        "ORDER BY last_at DESC LIMIT 1",
    )
      .bind(owner, subject, msg.counterpart, msg.sentAt - FALLBACK_THREAD_WINDOW_MS)
      .first<{ id: string }>();
    threadId = row?.id ?? null;
  }

  if (threadId) {
    await env.DB.prepare("UPDATE threads SET last_at = MAX(last_at, ?) WHERE id = ?").bind(msg.sentAt, threadId).run();
    return threadId;
  }

  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO threads (id, owner, subject, counterpart, last_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, owner, subject, msg.counterpart, msg.sentAt)
    .run();
  return id;
}

/** Returns false when this (resend_id, owner) copy was already stored. */
export async function insertMessage(env: Env, threadId: string, m: NewMessage): Promise<boolean> {
  return (await insertMessageStatement(env, threadId, m).run()).meta.changes > 0;
}

/** For batching with other writes; a no-op when this (resend_id, owner) copy already exists. */
export function insertMessageStatement(env: Env, threadId: string, m: NewMessage): D1PreparedStatement {
  return env.DB.prepare(
    "INSERT INTO messages (id, owner, thread_id, folder, mailbox, resend_id, message_id, in_reply_to, refs, " +
      "from_addr, to_addrs, cc_addrs, bcc_addrs, subject, snippet, html, text, sent_at, read) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (resend_id, owner) DO NOTHING",
  )
    .bind(
      m.id,
      m.owner,
      threadId,
      m.folder,
      m.mailbox,
      m.resend_id,
      m.message_id,
      m.in_reply_to,
      m.refs,
      m.from_addr,
      m.to_addrs,
      m.cc_addrs,
      m.bcc_addrs ?? "[]",
      m.subject,
      snippetOf(m.text, m.html),
      m.html,
      m.text,
      m.sent_at,
      m.read ? 1 : 0,
    );
}

export async function getMessageRow(env: Env, owner: string, id: string): Promise<MessageRow | null> {
  return env.DB.prepare("SELECT * FROM messages WHERE id = ? AND owner = ?").bind(id, owner).first<MessageRow>();
}

export async function getMessage(env: Env, owner: string, id: string): Promise<Message | null> {
  const row = await getMessageRow(env, owner, id);
  if (!row) return null;
  const { results } = await env.DB.prepare(
    "SELECT id, message_id, filename, content_type, size, content_id FROM attachments WHERE message_id = ?",
  )
    .bind(id)
    .all<AttachmentRow>();
  return toMessage(row, results.map(toAttachment));
}

export interface ListFilter {
  folder: Folder;
  /** One exact address, or "@domain" for every address on a domain. */
  mailbox?: string;
  cursor?: string;
  limit: number;
}

export async function listThreads(env: Env, owner: string, f: ListFilter): Promise<Page<ThreadSummary>> {
  const where = ["owner = ?", "folder = ?"];
  const params: (string | number)[] = [owner, f.folder];
  if (f.mailbox?.startsWith("@")) {
    where.push("substr(mailbox, instr(mailbox, '@')) = ?");
    params.push(f.mailbox.toLowerCase());
  } else if (f.mailbox) {
    where.push("mailbox = ?");
    params.push(f.mailbox.toLowerCase());
  }

  let after = "";
  const [cursorAt, cursorId] = (f.cursor ?? "").split(".");
  if (cursorAt && cursorId) {
    after = "AND (sent_at, thread_id) < (?, ?)";
    params.push(Number(cursorAt), cursorId);
  }
  params.push(f.limit + 1);

  const { results } = await env.DB.prepare(
    `WITH f AS (
       SELECT id, thread_id, mailbox, subject, from_addr, to_addrs, snippet, sent_at,
         ROW_NUMBER() OVER (PARTITION BY thread_id ORDER BY sent_at DESC, id DESC) AS rn,
         COUNT(*) OVER (PARTITION BY thread_id) AS n,
         SUM(read = 0) OVER (PARTITION BY thread_id) AS unread
       FROM messages WHERE ${where.join(" AND ")}
     )
     SELECT f.*, EXISTS (
       SELECT 1 FROM attachments a JOIN messages m ON a.message_id = m.id
       WHERE m.thread_id = f.thread_id AND a.content_id IS NULL
     ) AS has_att
     FROM f WHERE rn = 1 ${after}
     ORDER BY sent_at DESC, thread_id DESC LIMIT ?`,
  )
    .bind(...params)
    .all<{
      id: string;
      thread_id: string;
      mailbox: string;
      subject: string;
      from_addr: string;
      to_addrs: string;
      snippet: string;
      sent_at: number;
      n: number;
      unread: number;
      has_att: number;
    }>();

  const page = results.slice(0, f.limit);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => ({
      id: r.thread_id,
      latestId: r.id,
      mailbox: r.mailbox,
      subject: r.subject,
      from: r.from_addr,
      to: JSON.parse(r.to_addrs) as string[],
      snippet: r.snippet,
      lastAt: r.sent_at,
      count: r.n,
      unread: r.unread,
      hasAttachments: r.has_att === 1,
    })),
    nextCursor: results.length > f.limit && last ? `${last.sent_at}.${last.thread_id}` : null,
  };
}

export async function getThread(env: Env, owner: string, threadId: string): Promise<Thread | null> {
  const [messages, attachments] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM messages WHERE thread_id = ? AND owner = ? ORDER BY sent_at").bind(threadId, owner),
    env.DB.prepare(
      "SELECT a.id, a.message_id, a.filename, a.content_type, a.size, a.content_id FROM attachments a " +
        "JOIN messages m ON a.message_id = m.id WHERE m.thread_id = ? AND m.owner = ?",
    ).bind(threadId, owner),
  ]);
  const rows = (messages?.results ?? []) as MessageRow[];
  if (!rows.length) return null;

  const byMessage = new Map<string, AttachmentInfo[]>();
  for (const a of (attachments?.results ?? []) as AttachmentRow[]) {
    const list = byMessage.get(a.message_id) ?? [];
    list.push(toAttachment(a));
    byMessage.set(a.message_id, list);
  }
  const list = rows.map((r) => toMessage(r, byMessage.get(r.id) ?? []));
  return { id: threadId, subject: list[list.length - 1]!.subject, messages: list };
}

export async function setThreadRead(env: Env, owner: string, threadId: string, read: boolean): Promise<void> {
  await env.DB.prepare("UPDATE messages SET read = ? WHERE thread_id = ? AND owner = ? AND folder = 'inbox'")
    .bind(read ? 1 : 0, threadId, owner)
    .run();
}

/** Unread inbox mail, per address the owner received it on. */
export async function unreadByMailbox(env: Env, owner: string): Promise<Record<string, number>> {
  const { results } = await env.DB.prepare(
    "SELECT mailbox, COUNT(*) AS n FROM messages WHERE owner = ? AND folder = 'inbox' AND read = 0 GROUP BY mailbox",
  )
    .bind(owner)
    .all<{ mailbox: string; n: number }>();
  return Object.fromEntries(results.map((r) => [r.mailbox, r.n]));
}

/**
 * Deletes messages (and their attachment rows, by cascade), drops threads
 * left empty, then removes R2 objects nothing references any more.
 */
async function deleteWhere(env: Env, where: string, params: string[]): Promise<number> {
  const { results: keys } = await env.DB.prepare(
    `SELECT DISTINCT a.r2_key FROM attachments a JOIN messages m ON a.message_id = m.id WHERE ${where}`,
  )
    .bind(...params)
    .all<{ r2_key: string }>();
  const { results: deleted } = await env.DB.prepare(`DELETE FROM messages AS m WHERE ${where} RETURNING thread_id`)
    .bind(...params)
    .all<{ thread_id: string }>();

  const threads = [...new Set(deleted.map((d) => d.thread_id))];
  if (threads.length) {
    await env.DB.prepare(
      `DELETE FROM threads WHERE id IN (${threads.map(() => "?").join(", ")}) ` +
        "AND NOT EXISTS (SELECT 1 FROM messages WHERE thread_id = threads.id)",
    )
      .bind(...threads)
      .run();
  }
  await purgeObjects(env, keys.map((k) => k.r2_key));
  return deleted.length;
}

export function deleteMessage(env: Env, owner: string, id: string): Promise<number> {
  return deleteWhere(env, "m.id = ? AND m.owner = ?", [id, owner]);
}

export function deleteThread(env: Env, owner: string, threadId: string): Promise<number> {
  return deleteWhere(env, "m.thread_id = ? AND m.owner = ?", [threadId, owner]);
}

export function deleteAllFor(env: Env, owner: string): Promise<number> {
  return deleteWhere(env, "m.owner = ?", [owner]);
}
