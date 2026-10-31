import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { Me } from "../src/shared/types";
import { recordLogin } from "../src/worker/services/directory";
import { sessionKey } from "../src/worker/services/sessions";

const ORIGIN = "https://mail.test";

async function session(username: string, sub: string): Promise<string> {
  const token = crypto.randomUUID();
  const ts = Math.floor(Date.now() / 1000);
  const data = { username, sub, refreshToken: null, idToken: null, createdAt: ts, verifiedAt: ts, checkedAt: ts };
  await env.DB.prepare("INSERT INTO sessions (token, data, expires_at) VALUES (?, ?, ?)")
    .bind(await sessionKey(token), JSON.stringify(data), ts + 3600)
    .run();
  return token;
}

const call = (token: string, path: string, init: RequestInit = {}) =>
  exports.default.fetch(
    new Request(`${ORIGIN}${path}`, {
      ...init,
      headers: { cookie: `session=${token}`, origin: ORIGIN, "content-type": "application/json" },
    }),
  );

describe("the SSO picture and preferences", () => {
  it("keeps the picture from each sign-in, and starts with the old swipes", async () => {
    await recordLogin(env, { username: "pat", sub: "sub-pat", picture: "https://sso.test/a.png", refreshToken: null, idToken: "x" });
    const token = await session("pat", "sub-pat");
    let me = (await (await call(token, "/api/me")).json()) as Me;
    expect(me).toMatchObject({ picture: "https://sso.test/a.png", usePicture: true, swipeLeft: "bin", swipeRight: "read" });

    // A later sign-in with no picture clears it.
    await recordLogin(env, { username: "pat", sub: "sub-pat", picture: null, refreshToken: null, idToken: "x" });
    me = (await (await call(token, "/api/me")).json()) as Me;
    expect(me.picture).toBeNull();
  });

  it("saves only the preferences given", async () => {
    await recordLogin(env, { username: "lee", sub: "sub-lee", refreshToken: null, idToken: "x" });
    const token = await session("lee", "sub-lee");
    const res = await call(token, "/api/me/preferences", { method: "PATCH", body: JSON.stringify({ swipeLeft: "star" }) });
    expect(await res.json()).toEqual({ usePicture: true, swipeLeft: "star", swipeRight: "read" });

    await call(token, "/api/me/preferences", { method: "PATCH", body: JSON.stringify({ usePicture: false, swipeRight: "none" }) });
    const me = (await (await call(token, "/api/me")).json()) as Me;
    expect(me).toMatchObject({ usePicture: false, swipeLeft: "star", swipeRight: "none" });
  });

  it("refuses a swipe it doesn't know", async () => {
    await recordLogin(env, { username: "kai", sub: "sub-kai", refreshToken: null, idToken: "x" });
    const token = await session("kai", "sub-kai");
    const res = await call(token, "/api/me/preferences", { method: "PATCH", body: JSON.stringify({ swipeLeft: "archive" }) });
    expect(res.status).toBe(400);
  });
});
