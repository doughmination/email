-- Starring bookmarks a whole conversation. It stays starred through the Bin,
-- but the Starred view only shows what's outside it.
ALTER TABLE threads ADD COLUMN starred_at INTEGER;
CREATE INDEX threads_starred ON threads (owner, starred_at) WHERE starred_at IS NOT NULL;
