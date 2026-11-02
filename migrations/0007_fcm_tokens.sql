-- Devices running the Android app, which get notifications through Firebase
-- Cloud Messaging rather than Web Push. One row per app install's FCM token.
CREATE TABLE fcm_tokens (
  token TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE REFERENCES users (username) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE INDEX fcm_user ON fcm_tokens (username);
