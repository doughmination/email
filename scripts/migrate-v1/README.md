# Copy mail from the old inbox

One-off: copies the old inbox's mail (`email-db`) into the new schema
(`email-db-v2` + R2). It runs locally through `wrangler dev`, talking to the
real databases and bucket. Nothing is deployed.

```sh
# Optional but recommended: lets attachments the old inbox never stored be
# fetched again from Resend (only works while Resend still has the emails).
echo 'RESEND_API_KEY=re_...' > scripts/migrate-v1/.dev.vars

npx wrangler dev -c scripts/migrate-v1/wrangler.jsonc --port 8799
curl localhost:8799            # dry run: reports what it would copy
curl 'localhost:8799/?apply=1' # copies it

rm scripts/migrate-v1/.dev.vars
```

- Only mail for users who've signed in to the new inbox is copied (mailboxes
  belong to SSO accounts now). Anyone listed under `waitingForSignIn` signs in,
  then run `?apply=1` again.
- Running again is safe: ids come from the old rows, so copied mail is skipped.
  That includes its attachments, so add the Resend key *before* the first
  `?apply=1` if you want them.
- Old threads stay together; read/unread is kept.
