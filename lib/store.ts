import { db } from "./db";
import { deleteAttachment } from "./attachments";

export type StoredAttachment = {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  contentId?: string | null;
};

export type Folder = "inbox" | "sent" | "drafts";

export type StoredEmail = {
  id: string;
  from: string;
  to: string[];
  subject: string;
  html: string | null;
  text: string | null;
  receivedAt: string;
  attachments: StoredAttachment[];
  direction: "inbound" | "outbound";
  status: "sent" | "draft";
  messageId: string | null;
  inReplyTo: string | null;
  references: string | null;
  threadKey: string;
  owner: string;
  read: boolean;
};

// Outbound mail and drafts are read from the start; inbound mail starts unread.
export type NewEmail = Omit<StoredEmail, "read"> & { read?: boolean };

export type DraftInput = {
  to: string[];
  subject: string;
  html: string;
  attachments: StoredAttachment[];
  from?: string;
  inReplyTo?: string | null;
  references?: string | null;
  threadKey?: string | null;
  owner: string;
};

type Row = {
  id: string;
  owner: string;
  folder: Folder;
  from_addr: string;
  to_addrs: string;
  subject: string;
  html: string | null;
  text: string | null;
  received_at: string;
  attachments: string;
  direction: StoredEmail["direction"];
  status: StoredEmail["status"];
  message_id: string | null;
  in_reply_to: string | null;
  refs: string | null;
  thread_key: string;
  read: number;
};

const COLUMNS =
  "id, owner, folder, from_addr, to_addrs, subject, html, text, received_at, attachments, " +
  "direction, status, message_id, in_reply_to, refs, thread_key, read";

export function folderOf(email: Pick<StoredEmail, "direction" | "status">): Folder {
  if (email.status === "draft") return "drafts";
  return email.direction === "inbound" ? "inbox" : "sent";
}

function toEmail(row: Row): StoredEmail {
  return {
    id: row.id,
    from: row.from_addr,
    to: JSON.parse(row.to_addrs) as string[],
    subject: row.subject,
    html: row.html,
    text: row.text,
    receivedAt: row.received_at,
    attachments: JSON.parse(row.attachments) as StoredAttachment[],
    direction: row.direction,
    status: row.status,
    messageId: row.message_id,
    inReplyTo: row.in_reply_to,
    references: row.refs,
    threadKey: row.thread_key,
    owner: row.owner,
    read: row.read !== 0,
  };
}

async function readRow(id: string): Promise<Row | null> {
  return db().prepare(`SELECT ${COLUMNS} FROM emails WHERE id = ?`).bind(id).first<Row>();
}

async function deleteRows(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db().batch(ids.map((id) => db().prepare("DELETE FROM emails WHERE id = ?").bind(id)));
}

export async function addEmail(input: NewEmail): Promise<StoredEmail> {
  const email: StoredEmail = { ...input, read: input.read ?? input.direction !== "inbound" };
  const res = await db()
    .prepare(
      `INSERT INTO emails (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ` +
        "ON CONFLICT (id) DO NOTHING",
    )
    .bind(
      email.id,
      email.owner,
      folderOf(email),
      email.from,
      JSON.stringify(email.to),
      email.subject,
      email.html,
      email.text,
      email.receivedAt,
      JSON.stringify(email.attachments),
      email.direction,
      email.status,
      email.messageId,
      email.inReplyTo,
      email.references,
      email.threadKey,
      email.read ? 1 : 0,
    )
    .run();
  if (res.meta.changes > 0) return email;

  const existing = await readRow(email.id);
  return existing ? toEmail(existing) : email;
}

// Newest first within each folder; with no folder given, folders come back in
// alphabetical order (drafts, inbox, sent).
export async function listEmails(folder?: Folder, owner?: string) {
  const where: string[] = [];
  const params: string[] = [];
  if (folder) {
    where.push("folder = ?");
    params.push(folder);
  }
  if (owner) {
    where.push("owner = ?");
    params.push(owner);
  }

  const sql =
    `SELECT ${COLUMNS} FROM emails` +
    (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
    " ORDER BY folder, seq DESC";
  const { results } = await db()
    .prepare(sql)
    .bind(...params)
    .all<Row>();

  return results.map((row) => {
    const { html, text, ...meta } = toEmail(row);
    return meta;
  });
}

export async function getEmail(id: string): Promise<StoredEmail | null> {
  const row = await readRow(id);
  return row ? toEmail(row) : null;
}

export async function findByMessageId(messageId: string): Promise<StoredEmail | null> {
  const row = await db()
    .prepare(`SELECT ${COLUMNS} FROM emails WHERE message_id = ? ORDER BY seq DESC LIMIT 1`)
    .bind(messageId)
    .first<Row>();
  return row ? toEmail(row) : null;
}

async function rowsInThread(threadKey: string, owner?: string): Promise<Row[]> {
  const sql = owner
    ? `SELECT ${COLUMNS} FROM emails WHERE thread_key = ? AND owner = ? ORDER BY received_at`
    : `SELECT ${COLUMNS} FROM emails WHERE thread_key = ? ORDER BY received_at`;
  const stmt = owner ? db().prepare(sql).bind(threadKey, owner) : db().prepare(sql).bind(threadKey);
  return (await stmt.all<Row>()).results;
}

export async function listByThreadKey(threadKey: string, owner?: string): Promise<StoredEmail[]> {
  return (await rowsInThread(threadKey, owner)).map(toEmail);
}

export async function unreadCount(owner?: string): Promise<number> {
  const stmt = owner
    ? db().prepare("SELECT COUNT(*) AS n FROM emails WHERE folder = 'inbox' AND read = 0 AND owner = ?").bind(owner)
    : db().prepare("SELECT COUNT(*) AS n FROM emails WHERE folder = 'inbox' AND read = 0");
  return (await stmt.first<{ n: number }>())?.n ?? 0;
}

export async function setRead(ids: string[], read: boolean): Promise<void> {
  if (ids.length === 0) return;
  await db().batch(
    ids.map((id) => db().prepare("UPDATE emails SET read = ? WHERE id = ?").bind(read ? 1 : 0, id)),
  );
}

export async function createDraft(input: DraftInput): Promise<StoredEmail> {
  const draft: StoredEmail = {
    id: crypto.randomUUID(),
    from: input.from ?? "",
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: null,
    receivedAt: new Date().toISOString(),
    attachments: input.attachments,
    direction: "outbound",
    status: "draft",
    messageId: null,
    inReplyTo: input.inReplyTo ?? null,
    references: input.references ?? null,
    threadKey: input.threadKey ?? `draft::${crypto.randomUUID()}`,
    owner: input.owner,
    read: true,
  };
  await addEmail(draft);
  return draft;
}

export async function updateDraft(id: string, input: DraftInput): Promise<StoredEmail | null> {
  const row = await readRow(id);
  if (!row || row.status !== "draft") return null;
  const current = toEmail(row);

  const keep = new Set(input.attachments.map((a) => a.id).filter(Boolean));
  await Promise.all(
    current.attachments
      .filter((a) => a.id && !keep.has(a.id))
      .map((a) => deleteAttachment(a.id)),
  );

  const updated: StoredEmail = {
    ...current,
    from: input.from ?? current.from,
    to: input.to,
    subject: input.subject,
    html: input.html,
    attachments: input.attachments,
    receivedAt: new Date().toISOString(),
  };
  await db()
    .prepare(
      "UPDATE emails SET from_addr = ?, to_addrs = ?, subject = ?, html = ?, attachments = ?, received_at = ? " +
        "WHERE id = ?",
    )
    .bind(
      updated.from,
      JSON.stringify(updated.to),
      updated.subject,
      updated.html,
      JSON.stringify(updated.attachments),
      updated.receivedAt,
      id,
    )
    .run();
  return updated;
}

export async function deleteDraft(id: string): Promise<boolean> {
  const res = await db().prepare("DELETE FROM emails WHERE id = ? AND status = 'draft'").bind(id).run();
  return res.meta.changes > 0;
}

export async function deleteEmail(id: string): Promise<StoredEmail | null> {
  const row = await db()
    .prepare(`DELETE FROM emails WHERE id = ? RETURNING ${COLUMNS}`)
    .bind(id)
    .first<Row>();
  return row ? toEmail(row) : null;
}

export async function deleteByThreadKey(threadKey: string): Promise<StoredEmail[]> {
  const rows = await rowsInThread(threadKey);
  await deleteRows(rows.map((r) => r.id));
  return rows.map(toEmail);
}

// Every message (inbox, sent, drafts) belonging to one mailbox user. Used by the
// admin "delete user" flow, which wipes a user's mail before removing the user.
export async function deleteByOwner(owner: string): Promise<StoredEmail[]> {
  const { results } = await db()
    .prepare(`DELETE FROM emails WHERE owner = ? RETURNING ${COLUMNS}`)
    .bind(owner)
    .all<Row>();
  return results.map(toEmail);
}
