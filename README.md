# Inbox

A multi-domain mailbox on Cloudflare Workers. Mail comes in and goes out through
[Resend](https://resend.com), people sign in through the SSO, and every user gets
`<username>@<domain>` on each domain that's switched on. There's no config file:
domains, aliases and admins are managed from the Admin page.

## How it fits together

```
src/
  shared/types.ts      API shapes, used by both sides
  worker/              Hono API (only /api, /auth, /webhook reach the Worker)
    lib/routing.ts     who owns which address: pure, unit-tested
    services/          D1, R2, Resend, SSO, push
    routes/            HTTP handlers
  web/                 Svelte 5 app, served as static assets
    components/EmailFrame.svelte   the only place email HTML is rendered
migrations/            D1 schema
test/                  vitest, running inside workerd with local D1 + R2
```

- **D1** (`DB`) holds users, domains, aliases, threads, messages, sessions.
- **R2** (`BUCKET`) holds attachment bytes under `inbox/`. It's the same bucket the
  old proxy used.
- **Domains** are synced from Resend into D1 (`services/domains.ts`), never typed in.
- **Routing**: on an active domain, mail to `x@domain` goes to the alias `x` if
  there is one, otherwise to user `x`, otherwise to that domain's catch-all,
  otherwise nowhere. You can send from exactly the addresses whose mail reaches
  you. An email addressed to several users is stored once in each mailbox.
- **Email rendering**: email HTML goes in a sandboxed `srcdoc` iframe with no
  script, its own CSP, and remote content blocked until you click to load it.
  That keeps an email's fonts and styles inside the frame. Attachments are only
  ever shown inline when they're plain images.

## Setup

```sh
npm install
cp .dev.vars.example .dev.vars        # fill in the secrets
npx wrangler d1 create email-db-v2    # put the id in wrangler.jsonc
npm run db:migrate:local
npm run dev                           # http://localhost:5173
```

Local sign-in needs `http://localhost:5173/auth/callback` registered as a redirect
URI on the SSO client.

`ADMIN_USERS` in `wrangler.jsonc` lists people who are always admins. Anyone the
SSO lets in becomes a user on first sign-in.

## Deploying

```sh
npm run db:migrate:remote
npx wrangler secret put RESEND_API_KEY        # also RESEND_WEBHOOK_SECRET,
                                              # OIDC_CLIENT_SECRET, VAPID_PRIVATE_KEY
npm run deploy
```

Then:

1. In Resend, point a webhook at `https://<host>/webhook/inbound` for
   `email.received`, plus `domain.created`, `domain.updated` and `domain.deleted`.
2. That's it for domains. They come from your Resend account: every domain there
   is switched on automatically, and it routes mail once receiving is on in
   Resend. The list re-syncs on those webhooks, daily, and whenever Admin →
   Domains is opened. That page is where you switch one off or pick a catch-all.

## Demo

`/demo` (e.g. https://mail.doughmination.gay/demo) is the same app with made-up
mail and no sign-in. Under that path the API is swapped for an in-memory fake
(`src/web/lib/demo.ts`), so nothing touches the Worker, D1, R2 or Resend, and no
real email comes in or goes out. Sending moves a message to Sent, mail to one of
the demo's own addresses lands in its inbox, anyone else gets a pretend reply a
few seconds later, and reloading starts over. Locally it's at
http://localhost:5173/demo.

## Scripts

| | |
|---|---|
| `npm run dev` | Vite + the Worker in workerd, with hot reload |
| `npm run typecheck` | Worker and tests (`tsc`), and the app (`svelte-check`) |
| `npm test` | vitest inside workerd |
| `npm run types` | regenerate `worker-configuration.d.ts` after changing `wrangler.jsonc` |
