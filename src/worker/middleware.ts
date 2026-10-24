import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { getUser } from "./services/directory";
import { sessionIdentity } from "./services/sessions";

export type AppEnv = {
  Bindings: Env;
  Variables: { user: { username: string; isAdmin: boolean } };
};

/**
 * Session cookies are SameSite=Lax, which still lets sibling subdomains (same
 * site) send them. State-changing requests must come from this origin.
 */
export const sameOrigin = createMiddleware<AppEnv>(async (c, next) => {
  const method = c.req.method;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();
  const origin = c.req.header("origin");
  const site = c.req.header("sec-fetch-site");
  const self = new URL(c.req.url).origin;
  if (origin ? origin !== self : site !== undefined && site !== "same-origin" && site !== "none") {
    return c.json({ error: "Cross-site request refused" }, 403);
  }
  return next();
});

export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const identity = await sessionIdentity(c.env, getCookie(c, "session"));
  // A session outlives an admin deleting the user, and the username may since
  // belong to a different SSO account; the row, matched on sub, is the authority.
  const user = identity ? await getUser(c.env, identity.username) : null;
  if (!user || user.sub !== identity?.sub) return c.json({ error: "Unauthorized" }, 401);
  c.set("user", { username: user.username, isAdmin: user.isAdmin });
  return next();
});

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get("user").isAdmin) return c.json({ error: "Forbidden" }, 403);
  return next();
});
