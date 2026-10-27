import { env, exports } from "cloudflare:workers";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { addFcmToken, notifyFcm } from "../src/worker/services/fcm";
import { createSession } from "../src/worker/services/sessions";

const ORIGIN = "https://mail.test";

async function serviceAccount(): Promise<string> {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const der = new Uint8Array((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);
  const b64 = btoa(String.fromCharCode(...der)).replace(/(.{64})/g, "$1\n");
  return JSON.stringify({
    project_id: "inbox-test",
    client_email: "fcm@inbox-test.iam.gserviceaccount.com",
    private_key: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`,
  });
}

/** env with FCM switched on; everything else is inherited. */
let fcmEnv: Env;

beforeAll(async () => {
  // defineProperty, not assignment: assigning would go through env's proxy and change it for every test.
  fcmEnv = Object.defineProperty(Object.create(env) as Env, "FCM_SERVICE_ACCOUNT", { value: await serviceAccount() });
  await env.DB.prepare(
    "INSERT INTO users (username, sub, is_admin, created_at, last_login_at) VALUES ('noor', 'sub-noor', 0, 0, 0)",
  ).run();
});

afterEach(() => vi.restoreAllMocks());

describe("notifyFcm", () => {
  it("does nothing without a service account", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    await addFcmToken(env, "noor", "token-off");
    expect(await notifyFcm(env, "noor", { title: "t", body: "b" })).toEqual({ sent: 0, pruned: 0 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends a data message to each device and drops unregistered ones", async () => {
    await addFcmToken(env, "noor", "token-live");
    await addFcmToken(env, "noor", "token-gone");
    const sends: { url: string; auth: string | null; body: { message: Record<string, unknown> } }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        const form = new URLSearchParams(String(init?.body));
        expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
        return Response.json({ access_token: "google-token", expires_in: 3600 });
      }
      const body = JSON.parse(String(init?.body)) as { message: { token: string } };
      sends.push({ url, auth: new Headers(init?.headers).get("authorization"), body });
      if (body.message.token === "token-gone") {
        return Response.json({ error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } }, { status: 404 });
      }
      return Response.json({ name: "projects/inbox-test/messages/1" });
    });

    const result = await notifyFcm(fcmEnv, "noor", { title: "New email", body: "Hi", url: "/inbox/t1", tag: "m1" });

    expect(result.pruned).toBe(1);
    expect(result.sent).toBe(2); // token-off and token-live
    expect(sends.every((s) => s.url === "https://fcm.googleapis.com/v1/projects/inbox-test/messages:send")).toBe(true);
    expect(sends.every((s) => s.auth === "Bearer google-token")).toBe(true);
    expect(sends[0]!.body.message).toMatchObject({
      data: { title: "New email", body: "Hi", url: "/inbox/t1", tag: "m1" },
      android: { priority: "HIGH" },
    });
    const left = await env.DB.prepare("SELECT token FROM fcm_tokens WHERE username = 'noor' ORDER BY token").all();
    expect(left.results.map((r) => r.token)).toEqual(["token-live", "token-off"]);
  });
});

describe("FCM token registration", () => {
  it("registers through the API, at most 20 devices", async () => {
    const token = await createSession(env, { username: "noor", sub: "sub-noor", refreshToken: null, idToken: "x" });
    const register = (t: string) =>
      exports.default.fetch(
        new Request(`${ORIGIN}/api/push/fcm`, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ token: t }),
        }),
      );
    await env.DB.prepare("DELETE FROM fcm_tokens").run();
    for (let i = 0; i < 20; i++) expect((await register(`device-${i}`)).status).toBe(200);
    expect((await register("device-20")).status).toBe(400);
    expect((await register("device-5")).status).toBe(200);
  });
});
