// Shapes the API sends and receives, shared by the Worker and the Svelte app.

export type Folder = "inbox" | "sent" | "drafts";

export interface Me {
  username: string;
  isAdmin: boolean;
  /** Every address this user can send from, across all enabled domains. */
  addresses: string[];
  domains: string[];
  pushPublicKey: string | null;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ThreadSummary {
  id: string;
  /** The newest message in the folder being listed. */
  latestId: string;
  mailbox: string;
  subject: string;
  from: string;
  to: string[];
  snippet: string;
  lastAt: number;
  count: number;
  unread: number;
  hasAttachments: boolean;
}

export interface AttachmentInfo {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  contentId: string | null;
}

export interface Message {
  id: string;
  threadId: string;
  folder: Folder;
  mailbox: string;
  from: string;
  to: string[];
  cc: string[];
  /** Only on messages we sent (or drafts); always empty for received mail. */
  bcc: string[];
  subject: string;
  /** Plain-text preview, shown while the message is collapsed. */
  snippet: string;
  /** Email HTML. Only ever render it inside the sandboxed EmailFrame. */
  html: string | null;
  text: string | null;
  sentAt: number;
  read: boolean;
  attachments: AttachmentInfo[];
}

export interface Thread {
  id: string;
  subject: string;
  messages: Message[];
}

export interface ComposeInput {
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  /** Plain text; the server renders the HTML part from it. */
  text: string;
  /** Uploads, or attachments of the user's other messages when forwarding. */
  attachmentIds: string[];
  /** Message being replied to; threads the new one onto it. */
  replyTo?: string | null;
}

export interface DomainInfo {
  name: string;
  /** The admin's switch. New domains from Resend start switched on. */
  enabled: boolean;
  /** Actually routing mail: enabled, and Resend has receiving on. */
  active: boolean;
  catchAll: string | null;
  syncedAt: number | null;
  /** What Resend last reported; null once the domain is gone from Resend. */
  resend: { status: string; sending: boolean; receiving: boolean } | null;
}

export interface AliasInfo {
  localPart: string;
  /** "" means every domain. */
  domain: string;
  username: string;
}

export interface UserInfo {
  username: string;
  isAdmin: boolean;
  createdAt: number;
  lastLoginAt: number;
  messageCount: number;
  addresses: string[];
}

export interface ApiError {
  error: string;
}
