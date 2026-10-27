import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { sessionToken, type AppEnv } from "../middleware";
import { AccountConflict, ReservedUsername, recordLogin } from "../services/directory";
import {
  buildAuthUrl,
  completeLogin,
  endSessionUrl,
  issuerMatches,
  pkceChallenge,
  revokeRefreshToken,
} from "../services/oidc";
import {
  SESSION_TTL_S,
  createSession,
  destroySession,
  saveAppCode,
  savePending,
  takeAppCode,
  takePending,
} from "../services/sessions";

const secure = (env: Env) => env.COOKIE_SECURE !== "false";

/** Where an app-started login lands; the Android app handles this scheme. */
const APP_REDIRECT = "gay.doughmination.mail://auth";
/** An S256 PKCE challenge: 32 bytes, base64url. */
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

export const auth = new Hono<AppEnv>()
  .get("/login", async (c) => {
    try {
      const app = c.req.query("app");
      if (app !== undefined && !CHALLENGE.test(app)) return c.text("Bad app login request.", 400);
      const { url, pending } = await buildAuthUrl(c.env, c.req.query("from") || "/inbox", app);
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
      const username = await recordLogin(c.env, tokens);
      const token = await createSession(c.env, { ...tokens, username });
      if (pending.app) {
        return c.redirect(`${APP_REDIRECT}?code=${await saveAppCode(c.env, token, pending.app)}`);
      }
      setCookie(c, "session", token, {
        httpOnly: true,
        sameSite: "Lax",
        secure: secure(c.env),
        path: "/",
        maxAge: SESSION_TTL_S,
      });
      return c.redirect(pending.returnTo);
    } catch (e) {
      if (e instanceof ReservedUsername) {
        return c.text("Your SSO username is reserved here. Ask an admin to give you an account.", 403);
      }
      if (e instanceof AccountConflict) {
        return c.text("This username already belongs to another account here. Ask an admin to sort it out.", 403);
      }
      console.error("OIDC callback error", e);
      return c.text("Login failed.", 401);
    }
  })

  /** The Android app swaps its one-time code (and PKCE verifier) for a session token. */
  .post(
    "/app/token",
    zValidator("json", z.object({ code: z.uuid(), verifier: z.string().min(43).max(128) })),
    async (c) => {
      const { code, verifier } = c.req.valid("json");
      const token = await takeAppCode(c.env, code, async (challenge) => (await pkceChallenge(verifier)) === challenge);
      return token ? c.json({ token }) : c.json({ error: "That sign-in has expired. Try again." }, 400);
    },
  )

  .post("/logout", async (c) => {
    const ended = await destroySession(c.env, sessionToken(c).token);
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
