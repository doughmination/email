import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { getUser } from "./services/directory";
import { sessionIdentity } from "./services/sessions";

export type AppEnv = {
  Bindings: Env;
  Variables: {
    user: { username: string; isAdmin: boolean };
    /** Signed in with an Authorization header (the Android app) rather than the cookie. */
    bearer: boolean;
  };
};

/**
 * The session token a request carries: from `Authorization: Bearer` when
 * that header is there at all (never falling back to the cookie, so a bad
 * header can't ride on a browser's ambient session), otherwise the cookie.
 */
export function sessionToken(c: Context<AppEnv>): { token: string | undefined; bearer: boolean } {
  const header = c.req.header("authorization");
  if (header === undefined) return { token: getCookie(c, "session"), bearer: false };
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return { token: match?.[1], bearer: true };
}

/**
 * Session cookies are SameSite=Lax, which still lets sibling subdomains (same
 * site) send them. State-changing requests must come from this origin.
 */
export const sameOrigin = createMiddleware<AppEnv>(async (c, next) => {
  const method = c.req.method;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();
  // A browser can't add an Authorization header cross-site without a CORS
  // preflight, which nothing here answers, so these can't be forged.
  if (c.req.header("authorization") !== undefined) return next();
  const origin = c.req.header("origin");
  const site = c.req.header("sec-fetch-site");
  const self = new URL(c.req.url).origin;
  if (origin ? origin !== self : site !== undefined && site !== "same-origin" && site !== "none") {
    return c.json({ error: "Cross-site request refused" }, 403);
  }
  return next();
});

export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const { token, bearer } = sessionToken(c);
  const identity = await sessionIdentity(c.env, token);
  // A session outlives an admin deleting the user, and the username may since
  // belong to a different SSO account; the row, matched on sub, is the authority.
  const user = identity ? await getUser(c.env, identity.username) : null;
  if (!user || user.sub !== identity?.sub) return c.json({ error: "Unauthorized" }, 401);
  c.set("user", { username: user.username, isAdmin: user.isAdmin });
  c.set("bearer", bearer);
  return next();
});

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get("user").isAdmin) return c.json({ error: "Forbidden" }, 403);
  return next();
});
