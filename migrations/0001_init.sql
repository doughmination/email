-- Messages in every folder. `seq` keeps insertion order, which is what the
-- folder listings sort by (a draft's received_at moves on every save).
CREATE TABLE emails (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  owner TEXT NOT NULL COLLATE NOCASE,
  folder TEXT NOT NULL,
  from_addr TEXT NOT NULL,
  to_addrs TEXT NOT NULL,
  subject TEXT NOT NULL,
  html TEXT,
  text TEXT,
  received_at TEXT NOT NULL,
  attachments TEXT NOT NULL,
  direction TEXT NOT NULL,
  status TEXT NOT NULL,
  message_id TEXT,
  in_reply_to TEXT,
  refs TEXT,
  thread_key TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX emails_folder ON emails (folder, seq);
CREATE INDEX emails_owner ON emails (owner, folder, seq);
CREATE INDEX emails_unread ON emails (owner, folder) WHERE read = 0;
CREATE INDEX emails_thread ON emails (thread_key);
CREATE INDEX emails_message_id ON emails (message_id) WHERE message_id IS NOT NULL;

-- D1 caps a row at 2 MB, so attachment bytes are split across chunks.
CREATE TABLE attachment_chunks (
  attachment_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (attachment_id, idx)
);

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
  data TEXT NOT NULL
);

-- Singleton JSON documents: "settings" and "owners".
CREATE TABLE config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
