-- The picture the SSO has for the account (its `picture` claim), refreshed on
-- every sign-in. use_picture is the user's choice in Settings: 1 shows it,
-- 0 shows the default (their initial) instead.
ALTER TABLE users ADD COLUMN picture TEXT;
ALTER TABLE users ADD COLUMN use_picture INTEGER NOT NULL DEFAULT 1;

-- What swiping a row in the list does, set in Settings. One of none, read
-- (toggle read), star (toggle starred) or bin. The defaults are what swiping
-- always did before.
ALTER TABLE users ADD COLUMN swipe_left TEXT NOT NULL DEFAULT 'bin';
ALTER TABLE users ADD COLUMN swipe_right TEXT NOT NULL DEFAULT 'read';
