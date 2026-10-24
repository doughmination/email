-- Domains now come from Resend: a sync copies its list in, and `enabled` is
-- only the admin's on/off switch. A domain routes mail when it's enabled and
-- Resend has receiving turned on for it; one that disappears from Resend
-- keeps its row (and catch-all) but stops routing.
ALTER TABLE domains ADD COLUMN receiving INTEGER NOT NULL DEFAULT 0;
ALTER TABLE domains ADD COLUMN sending INTEGER NOT NULL DEFAULT 0;
ALTER TABLE domains ADD COLUMN resend_status TEXT;
ALTER TABLE domains ADD COLUMN synced_at INTEGER;
