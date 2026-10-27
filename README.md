# Inbox

A multi-domain mailbox on Cloudflare Workers, and its Android app.

- [`email/`](email/): the Worker (Hono API on D1 + R2, mail through Resend) and
  the Svelte web app it serves. See its README for setup and deploys.
- [`app/`](app/): the Android app.

CI lives in `.github/workflows/`: `server.yml` typechecks and tests `email/`,
`android.yml` builds the APK. Each only runs when its own folder changes.
