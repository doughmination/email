import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { notifyLive } from "../src/worker/services/live";

const ORIGIN = "https://mail.test";

let token: string;

beforeAll(async () => {
  const now = Date.now();
  await env.DB.prepare("INSERT INTO users (username, sub, is_admin, created_at, last_login_at) VALUES (?, ?, 0, ?, ?)")
    .bind("clove", "sub-clove", now, now)
    .run();
  token = crypto.randomUUID();
  const ts = Math.floor(now / 1000);
  const session = { username: "clove", sub: "sub-clove", refreshToken: null, idToken: null, createdAt: ts, verifiedAt: ts, checkedAt: ts };
  await env.DB.prepare("INSERT INTO sessions (token, data, expires_at) VALUES (?, ?, ?)")
    .bind(token, JSON.stringify(session), ts + 3600)
    .run();
});

function open(headers: Record<string, string> = {}) {
  return exports.default.fetch(
    new Request(`${ORIGIN}/api/live`, {
      headers: { upgrade: "websocket", cookie: `session=${token}`, origin: ORIGIN, ...headers },
    }),
  );
}

function nextMessage(ws: WebSocket): Promise<string> {
  return new Promise((resolve) => ws.addEventListener("message", (e) => resolve(e.data as string), { once: true }));
}

describe("live updates", () => {
  it("pushes new mail to the owner's open sockets", async () => {
    const res = await open();
    expect(res.status).toBe(101);
    const ws = res.webSocket!;
    ws.accept();

    ws.send("ping");
    expect(await nextMessage(ws)).toBe("pong");

    const got = nextMessage(ws);
    await notifyLive(env, "Clove", { type: "mail", threadId: "t1" });
    expect(JSON.parse(await got)).toEqual({ type: "mail", threadId: "t1" });
    ws.close();
  });

  it("refuses cross-site handshakes and signed-out users", async () => {
    expect((await open({ origin: "https://evil.test" })).status).toBe(403);
    expect((await open({ cookie: "" })).status).toBe(401);
    expect((await open({ upgrade: "" })).status).toBe(426);
  });
});
