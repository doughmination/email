import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { requireUser, sameOrigin, type AppEnv } from "./middleware";
import { admin } from "./routes/admin";
import { auth } from "./routes/auth";
import { mail } from "./routes/mail";
import { webhook } from "./routes/webhook";
import { sweepOrphanUploads } from "./services/attachments";
import { syncDomains } from "./services/domains";
import { sweepExpired } from "./services/sessions";

// Only /api, /auth and /webhook reach the Worker (see run_worker_first in
// wrangler.jsonc); the Svelte app is served straight from assets.
const app = new Hono<AppEnv>()
  .use(secureHeaders({ referrerPolicy: "no-referrer", crossOriginResourcePolicy: "same-origin" }))
  .route("/webhook", webhook)
  .use(sameOrigin)
  .route("/auth", auth)
  .use("/api/*", requireUser)
  .route("/api/admin", admin)
  .route("/api", mail)
  .notFound((c) => c.json({ error: "Not found" }, 404))
  .onError((err, c) => {
    console.error(err);
    return c.json({ error: "Something went wrong." }, 500);
  });

export default {
  fetch: app.fetch,
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(Promise.all([sweepExpired(env), sweepOrphanUploads(env), syncDomains(env)]));
  },
} satisfies ExportedHandler<Env>;
