import { db } from "./db";

// D1 caps a row at 2 MB; stay well under it.
const CHUNK_BYTES = 1_000_000;
import type { StoredAttachment } from "./store";

export async function saveAttachment(
  filename: string,
  contentType: string,
  base64Content: string,
  contentId?: string | null,
): Promise<StoredAttachment> {
  const id = crypto.randomUUID();
  const bytes = Buffer.from(base64Content, "base64");
  const cid = normalizeContentId(contentId);
  const name = filename || "attachment";
  const type = contentType || "application/octet-stream";
  const inserts = [];
  for (let idx = 0, off = 0; off < bytes.length || idx === 0; idx++, off += CHUNK_BYTES) {
    inserts.push(
      db()
        .prepare("INSERT INTO attachment_chunks (attachment_id, idx, data) VALUES (?, ?, ?)")
        .bind(id, idx, bytes.subarray(off, off + CHUNK_BYTES)),
    );
  }
  await db().batch(inserts);
  return { id, filename: name, contentType: type, size: bytes.length, contentId: cid };
}

async function saveAttachmentMeta(
  filename: string,
  contentType: string,
  contentId: string | null,
): Promise<StoredAttachment> {
  const id = crypto.randomUUID();
  const name = filename || "attachment";
  const type = contentType || "application/octet-stream";
  return { id, filename: name, contentType: type, size: 0, contentId };
}

export function normalizeContentId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().replace(/^<|>$/g, "").trim();
  return trimmed || null;
}

export async function readAttachment(attachmentId: string): Promise<Uint8Array | null> {
  if (!attachmentId) return null;
  const { results } = await db()
    .prepare("SELECT data FROM attachment_chunks WHERE attachment_id = ? ORDER BY idx")
    .bind(attachmentId)
    .all<{ data: ArrayBuffer | number[] }>();
  if (results.length === 0) return null;
  const parts = results.map((r) => new Uint8Array(r.data));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export async function deleteAttachment(attachmentId: string): Promise<void> {
  if (!attachmentId) return;
  await db().prepare("DELETE FROM attachment_chunks WHERE attachment_id = ?").bind(attachmentId).run();
}

export async function toResendAttachment(
  att: StoredAttachment,
): Promise<{ filename: string; content: string } | null> {
  const bytes = await readAttachment(att.id);
  if (!bytes) return null;
  return {
    filename: att.filename,
    content: Buffer.from(bytes).toString("base64"),
  };
}

export async function persistInboundAttachments(attachments: unknown): Promise<StoredAttachment[]> {
  if (!Array.isArray(attachments)) return [];

  const results: StoredAttachment[] = [];
  for (const raw of attachments) {
    if (!raw || typeof raw !== "object") continue;
    const a = raw as Record<string, unknown>;
    const content = typeof a.content === "string" ? a.content : null;
    const filename =
      (typeof a.filename === "string" && a.filename) ||
      (typeof a.name === "string" && a.name) ||
      "attachment";
    const contentType =
      (typeof a.contentType === "string" && a.contentType) ||
      (typeof a.content_type === "string" && a.content_type) ||
      (typeof a.type === "string" && a.type) ||
      "application/octet-stream";
    const contentId = normalizeContentId(
      (typeof a.contentId === "string" && a.contentId) ||
        (typeof a.content_id === "string" && a.content_id) ||
        (typeof a.cid === "string" && a.cid) ||
        null,
    );

    if (!content) {
      try {
        results.push(await saveAttachmentMeta(filename, contentType, contentId));
      } catch (err) {
        console.error("Failed to persist inbound attachment metadata", filename, err);
      }
      continue;
    }

    try {
      results.push(await saveAttachment(filename, contentType, content, contentId));
    } catch (err) {
      console.error("Failed to persist inbound attachment", filename, err);
    }
  }
  return results;
}
