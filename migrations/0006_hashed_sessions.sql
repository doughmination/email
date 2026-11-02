-- Sessions are now keyed by a SHA-256 of the cookie's token rather than the
-- token itself. Old rows can't be matched any more, so everyone signs in once.
DELETE FROM sessions;
