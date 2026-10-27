import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppEnv } from "../middleware";
import { AccountConflict, recordLogin } from "../services/directory";
import { buildAuthUrl, completeLogin, endSessionUrl, issuerMatches, revokeRefreshToken } from "../services/oidc";
import { SESSION_TTL_S, createSession, destroySession, savePending, takePending } from "../services/sessions";

const secure = (env: Env) => env.COOKIE_SECURE !== "false";

export const auth = new Hono<AppEnv>()
  .get("/login", async (c) => {
    try {
      const { url, pending } = await buildAuthUrl(c.env, c.req.query("from") || "/inbox");
      const id = await savePending(c.env, pending);
      setCookie(c, "login", id, { httpOnly: true, sameSite: "Lax", secure: secure(c.env), path: "/", maxAge: 600 });
      return c.redirect(url);
    } catch (err) {
      console.error("OIDC login start failed", err);
      return c.text("Login is temporarily unavailable.", 500);
    }
  })

  .get("/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const err = c.req.query("error");
    if (err === "access_denied") {
      return c.text(
        "Your SSO account isn't allowed to use the inbox. Ask an SSO admin to add you to its allowed groups.",
        403,
      );
    }
    if (err) return c.text(`Login failed: ${err}`, 401);
    if (!issuerMatches(c.env, c.req.query("iss"))) return c.text("Login failed: unexpected issuer.", 401);

    const pending = await takePending(c.env, getCookie(c, "login"));
    deleteCookie(c, "login", { path: "/" });
    if (!pending || !code || !state || state !== pending.state) return c.redirect("/auth/login");

    try {
      const tokens = await completeLogin(c.env, code, pending);
      await recordLogin(c.env, tokens);
      const token = await createSession(c.env, tokens);
      setCookie(c, "session", token, {
        httpOnly: true,
        sameSite: "Lax",
        secure: secure(c.env),
        path: "/",
        maxAge: SESSION_TTL_S,
      });
      return c.redirect(pending.returnTo);
    } catch (e) {
      if (e instanceof AccountConflict) {
        return c.text("This username already belongs to another account here. Ask an admin to sort it out.", 403);
      }
      console.error("OIDC callback error", e);
      return c.text("Login failed.", 401);
    }
  })

  .post("/logout", async (c) => {
    const ended = await destroySession(c.env, getCookie(c, "session"));
    deleteCookie(c, "session", { path: "/" });
    if (ended?.refreshToken) {
      c.executionCtx.waitUntil(
        revokeRefreshToken(c.env, ended.refreshToken).catch((err) =>
          console.warn("refresh token revocation failed", err),
        ),
      );
    }
    // The client navigates here so the SSO session ends as well.
    return c.json({ ok: true, endSession: await endSessionUrl(c.env, ended?.idToken ?? null) });
  });
