import type { AttachmentInfo } from "../../shared/types";
import { chunks } from "../lib/chunk";

// Everything this app writes sits under inbox/, apart from the proxy's
// objects in the same bucket.
const PREFIX = "inbox";
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
// Resend takes 40 MB per email once attachments are base64'd (a third bigger).
export const MAX_MESSAGE_ATTACHMENT_BYTES = 28 * 1024 * 1024;
const ORPHAN_UPLOAD_TTL_MS = 1000 * 60 * 60 * 24 * 2;

export function inboundKey(resendEmailId: string, resendAttachmentId: string): string {
  return `${PREFIX}/received/${resendEmailId}/${resendAttachmentId}`;
}

export interface AttachmentRecord {
  id: string;
  owner: string;
  messageId: string | null;
  r2Key: string;
  filename: string;
  contentType: string;
  size: number;
  contentId: string | null;
}

/**
 * Inserts nothing when messageId is set but that message doesn't exist, so
 * it can be batched after a message insert that may have been a no-op.
 */
export function insertAttachmentStatement(env: Env, a: AttachmentRecord): D1PreparedStatement {
  return env.DB.prepare(
    "INSERT INTO attachments (id, owner, message_id, r2_key, filename, content_type, size, content_id, created_at) " +
      "SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9 " +
      "WHERE ?3 IS NULL OR EXISTS (SELECT 1 FROM messages WHERE id = ?3) ON CONFLICT (id) DO NOTHING",
  ).bind(a.id, a.owner, a.messageId, a.r2Key, a.filename, a.contentType, a.size, a.contentId, Date.now());
}

export function cleanContentId(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim().replace(/^<|>$/g, "").trim();
  return trimmed || null;
}

/** Stores a file a user is about to attach; it's claimed when the message is sent or saved. */
export async function saveUpload(env: Env, owner: string, file: File): Promise<AttachmentInfo> {
  const id = crypto.randomUUID();
  const key = `${PREFIX}/uploads/${id}`;
  const contentType = file.type || "application/octet-stream";
  await env.BUCKET.put(key, file.stream(), { httpMetadata: { contentType } });
  const record: AttachmentRecord = {
    id,
    owner,
    messageId: null,
    r2Key: key,
    filename: file.name || "attachment",
    contentType,
    size: file.size,
    contentId: null,
  };
  await insertAttachmentStatement(env, record).run();
  return { id, filename: record.filename, contentType, size: record.size, contentId: null };
}

/**
 * Makes `ids` exactly the attachments on `messageId`. Each id must be one of
 * the owner's own attachments, so a client can't attach somebody else's file
 * by guessing its id:
 *  - an unclaimed upload is moved onto the message;
 *  - one on another message (forwarding) is copied, sharing the R2 object.
 */
export async function setMessageAttachments(
  env: Env,
  owner: string,
  messageId: string,
  ids: string[],
): Promise<void> {
  const unique = [...new Set(ids)];
  const keep: string[] = [];

  if (unique.length) {
    const { results } = await env.DB.prepare(
      `SELECT * FROM attachments WHERE owner = ? AND id IN (${unique.map(() => "?").join(", ")})`,
    )
      .bind(owner, ...unique)
      .all<{
        id: string;
        message_id: string | null;
        r2_key: string;
        filename: string;
        content_type: string;
        size: number;
        content_id: string | null;
      }>();
    if (results.length !== unique.length) throw new Error("Unknown attachment");

    const writes: D1PreparedStatement[] = [];
    for (const row of results) {
      if (row.message_id === messageId) {
        keep.push(row.id);
      } else if (row.message_id === null) {
        keep.push(row.id);
        writes.push(env.DB.prepare("UPDATE attachments SET message_id = ? WHERE id = ?").bind(messageId, row.id));
      } else {
        const copy = crypto.randomUUID();
        keep.push(copy);
        writes.push(
          insertAttachmentStatement(env, {
            id: copy,
            owner,
            messageId,
            r2Key: row.r2_key,
            filename: row.filename,
            contentType: row.content_type,
            size: row.size,
            contentId: row.content_id,
          }),
        );
      }
    }
    if (writes.length) await env.DB.batch(writes);
  }

  const marks = keep.map(() => "?").join(", ");
  const { results } = await env.DB.prepare(
    `DELETE FROM attachments WHERE message_id = ? AND owner = ?${keep.length ? ` AND id NOT IN (${marks})` : ""} ` +
      "RETURNING r2_key",
  )
    .bind(messageId, owner, ...keep)
    .all<{ r2_key: string }>();
  await purgeObjects(env, results.map((r) => r.r2_key));
}

export async function getAttachment(env: Env, owner: string, id: string): Promise<AttachmentRecord | null> {
  const row = await env.DB.prepare(
    "SELECT id, owner, message_id, r2_key, filename, content_type, size, content_id FROM attachments " +
      "WHERE id = ? AND owner = ?",
  )
    .bind(id, owner)
    .first<{
      id: string;
      owner: string;
      message_id: string | null;
      r2_key: string;
      filename: string;
      content_type: string;
      size: number;
      content_id: string | null;
    }>();
  return row
    ? {
        id: row.id,
        owner: row.owner,
        messageId: row.message_id,
        r2Key: row.r2_key,
        filename: row.filename,
        contentType: row.content_type,
        size: row.size,
        contentId: row.content_id,
      }
    : null;
}

export class AttachmentsTooLarge extends Error {}

/** Base64 bodies in the shape Resend's send API wants. */
export async function forResend(
  env: Env,
  owner: string,
  messageId: string,
): Promise<{ filename: string; content: string; contentType: string; contentId?: string }[]> {
  const { results } = await env.DB.prepare(
    "SELECT r2_key, filename, content_type, content_id, size FROM attachments WHERE message_id = ? AND owner = ?",
  )
    .bind(messageId, owner)
    .all<{ r2_key: string; filename: string; content_type: string; content_id: string | null; size: number }>();
  // Checked before anything is read: every file is held in memory, base64'd, at once.
  if (results.reduce((n, r) => n + r.size, 0) > MAX_MESSAGE_ATTACHMENT_BYTES) throw new AttachmentsTooLarge();

  return Promise.all(
    results.map(async (r) => {
      const obj = await env.BUCKET.get(r.r2_key);
      if (!obj) throw new Error(`Attachment ${r.filename} is missing from storage`);
      return {
        filename: r.filename,
        content: Buffer.from(await obj.arrayBuffer()).toString("base64"),
        contentType: r.content_type,
        ...(r.content_id ? { contentId: r.content_id } : {}),
      };
    }),
  );
}

/** Deletes R2 objects once no attachment row points at them. */
export async function purgeObjects(env: Env, keys: string[]): Promise<void> {
  const unique = [...new Set(keys)];
  if (!unique.length) return;
  const found = await env.DB.batch<{ r2_key: string }>(
    chunks(unique).map((slice) =>
      env.DB.prepare(
        `SELECT DISTINCT r2_key FROM attachments WHERE r2_key IN (${slice.map(() => "?").join(", ")})`,
      ).bind(...slice),
    ),
  );
  const stillUsed = new Set(found.flatMap((r) => r.results.map((row) => row.r2_key)));
  const dead = unique.filter((k) => !stillUsed.has(k));
  // R2 deletes up to 1000 keys per call.
  for (const slice of chunks(dead, 1000)) await env.BUCKET.delete(slice);
}

/** Uploads that were never sent or saved into a draft. Run from the cron. */
export async function sweepOrphanUploads(env: Env): Promise<void> {
  const { results } = await env.DB.prepare(
    "DELETE FROM attachments WHERE message_id IS NULL AND created_at < ? RETURNING r2_key",
  )
    .bind(Date.now() - ORPHAN_UPLOAD_TTL_MS)
    .all<{ r2_key: string }>();
  await purgeObjects(env, results.map((r) => r.r2_key));
}
