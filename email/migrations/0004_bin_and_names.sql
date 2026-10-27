-- The name people see on mail a user sends. Filled from the SSO's `name`
-- claim on first sign-in, then the user's to change in Settings.
ALTER TABLE users ADD COLUMN display_name TEXT;

-- Deleting moves a message to the Bin rather than removing it; it keeps its
-- folder so restoring puts it back where it was. The daily cron empties
-- anything that's been in the Bin for 30 days.
ALTER TABLE messages ADD COLUMN trashed_at INTEGER;
CREATE INDEX messages_bin ON messages (owner, trashed_at) WHERE trashed_at IS NOT NULL;
