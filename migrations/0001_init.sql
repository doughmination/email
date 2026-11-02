-- Everyone the SSO lets in gets a row on first sign-in. `sub` pins the row to
-- one SSO account, so a username that's freed and re-registered on the SSO
-- can't inherit the old owner's mail.
CREATE TABLE users (
  username TEXT PRIMARY KEY COLLATE NOCASE,
  sub TEXT NOT NULL UNIQUE,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER NOT NULL
);

-- Domains this inbox handles. Every user owns <username>@<name> on each
-- enabled domain. Mail to an address nobody owns goes to catch_all, or is
-- dropped when that's NULL.
CREATE TABLE domains (
  name TEXT PRIMARY KEY COLLATE NOCASE,
  enabled INTEGER NOT NULL DEFAULT 1,
  catch_all TEXT COLLATE NOCASE REFERENCES users (username) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);

-- Extra addresses handed to a user (admin@, ctf@ ...). domain '' means that
-- local part on every domain; a row for a specific domain wins over it.
CREATE TABLE aliases (
  local_part TEXT NOT NULL COLLATE NOCASE,
  domain TEXT NOT NULL DEFAULT '' COLLATE NOCASE,
  username TEXT NOT NULL COLLATE NOCASE REFERENCES users (username) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (local_part, domain)
);
CREATE INDEX aliases_user ON aliases (username);

-- A conversation within one user's mailbox. subject (Re:/Fwd: stripped) and
-- counterpart are only used to thread replies that arrive without usable
-- In-Reply-To/References headers.
CREATE TABLE threads (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL COLLATE NOCASE REFERENCES users (username) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  counterpart TEXT NOT NULL,
  last_at INTEGER NOT NULL
);
CREATE INDEX threads_match ON threads (owner, subject, counterpart, last_at);

-- One row per copy: an email addressed to two users here is stored twice,
-- once in each mailbox. `mailbox` is the owner's address it was sent to (or
-- from), which is what the per-address/per-domain views filter on.
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL COLLATE NOCASE REFERENCES users (username) ON DELETE CASCADE,
  thread_id TEXT NOT NULL REFERENCES threads (id) ON DELETE CASCADE,
  folder TEXT NOT NULL CHECK (folder IN ('inbox', 'sent', 'drafts')),
  mailbox TEXT NOT NULL COLLATE NOCASE,
  resend_id TEXT,
  message_id TEXT,
  in_reply_to TEXT,
  refs TEXT,
  from_addr TEXT NOT NULL,
  to_addrs TEXT NOT NULL DEFAULT '[]',
  cc_addrs TEXT NOT NULL DEFAULT '[]',
  subject TEXT NOT NULL,
  snippet TEXT NOT NULL DEFAULT '',
  html TEXT,
  text TEXT,
  sent_at INTEGER NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  UNIQUE (resend_id, owner)
);
CREATE INDEX messages_thread ON messages (thread_id, sent_at);
CREATE INDEX messages_folder ON messages (owner, folder, sent_at);
CREATE INDEX messages_unread ON messages (owner) WHERE folder = 'inbox' AND read = 0;
CREATE INDEX messages_message_id ON messages (owner, message_id) WHERE message_id IS NOT NULL;

-- Bytes live in R2. An inbound email reaching several users shares one
-- object, so an object is deleted only once no row points at it. Uploads
-- have no message_id until they're saved into a draft or sent.
CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL COLLATE NOCASE REFERENCES users (username) ON DELETE CASCADE,
  message_id TEXT REFERENCES messages (id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  content_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX attachments_message ON attachments (message_id);
CREATE INDEX attachments_r2 ON attachments (r2_key);
CREATE INDEX attachments_orphans ON attachments (created_at) WHERE message_id IS NULL;

CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_expiry ON sessions (expires_at);

CREATE TABLE pending_logins (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE REFERENCES users (username) ON DELETE CASCADE,
  data TEXT NOT NULL
);
CREATE INDEX push_user ON push_subscriptions (username);
