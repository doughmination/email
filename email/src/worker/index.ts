import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { requireUser, sameOrigin, type AppEnv } from "./middleware";
import { admin } from "./routes/admin";
import { auth } from "./routes/auth";
import { download } from "./routes/download";
import { mail } from "./routes/mail";
import { webhook } from "./routes/webhook";
import { sweepOrphanUploads } from "./services/attachments";
import { syncDomains } from "./services/domains";
import { LiveHub } from "./services/live";
import { purgeBin } from "./services/messages";
import { sweepExpired } from "./services/sessions";

// Only /api, /auth, /webhook and /download reach the Worker (see run_worker_first in
// wrangler.jsonc); the Svelte app is served straight from assets.
const app = new Hono<AppEnv>()
  .use(secureHeaders({ referrerPolicy: "no-referrer", crossOriginResourcePolicy: "same-origin" }))
  .route("/webhook", webhook)
  .route("/download", download)
  .use(sameOrigin)
  .route("/auth", auth)
  .use("/api/*", requireUser)
  .get("/api/live", async (c) => {
    if (c.req.header("upgrade")?.toLowerCase() !== "websocket") return c.json({ error: "Expected a WebSocket" }, 426);
    // Browsers send cookies on cross-site WebSocket handshakes and sameOrigin
    // lets GETs through, so check the origin here. The app's bearer token
    // isn't ambient, so it has nothing to forge.
    if (!c.get("bearer") && c.req.header("origin") !== new URL(c.req.url).origin) {
      return c.json({ error: "Cross-site request refused" }, 403);
    }
    const res = await c.env.LIVE.getByName(c.get("user").username.toLowerCase()).fetch(c.req.raw);
    // Re-wrapped: the stub's response has immutable headers, which secureHeaders needs to set.
    return new Response(null, { status: res.status, webSocket: res.webSocket });
  })
  .route("/api/admin", admin)
  .route("/api", mail)
  .notFound((c) => c.json({ error: "Not found" }, 404))
  .onError((err, c) => {
    console.error(err);
    return c.json({ error: "Something went wrong." }, 500);
  });

export { LiveHub };

export default {
  fetch: app.fetch,
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(Promise.all([sweepExpired(env), sweepOrphanUploads(env), syncDomains(env), purgeBin(env)]));
  },
} satisfies ExportedHandler<Env>;
