-- Bcc is only ever known for mail we send: it's kept on drafts and Sent so
-- you can see who you Bcc'd, and stays '[]' on everything received.
ALTER TABLE messages ADD COLUMN bcc_addrs TEXT NOT NULL DEFAULT '[]';
