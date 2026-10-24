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
- **Routing**: on an enabled domain, mail to `x@domain` goes to the alias `x` if
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

1. In Resend, point the `email.received` webhook at `https://<host>/webhook/inbound`.
2. In Admin → Domains, switch on each Resend domain the inbox should handle, and
   pick a catch-all if you want one. A new domain needs receiving set up in
   Resend first.

## Scripts

| | |
|---|---|
| `npm run dev` | Vite + the Worker in workerd, with hot reload |
| `npm run typecheck` | Worker (`tsc`) and app (`svelte-check`) |
| `npm test` | vitest inside workerd |
| `npm run types` | regenerate `worker-configuration.d.ts` after changing `wrangler.jsonc` |
