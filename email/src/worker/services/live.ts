import { DurableObject } from "cloudflare:workers";

export type LiveEvent = { type: "mail"; threadId: string };

/**
 * One per user: holds the WebSockets of their open tabs so new mail can be
 * pushed to them as it lands. Uses the hibernation API, so an idle socket
 * costs nothing; the client's keep-alive pings are answered without waking it.
 */
export class LiveHub extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  override async fetch(): Promise<Response> {
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server!);
    return new Response(null, { status: 101, webSocket: client });
  }

  broadcast(event: LiveEvent): number {
    const data = JSON.stringify(event);
    const sockets = this.ctx.getWebSockets();
    for (const ws of sockets) {
      try {
        ws.send(data);
      } catch {
        // Already closing; it'll be dropped from getWebSockets() shortly.
      }
    }
    return sockets.length;
  }
}

/** Tells `username`'s open tabs something changed. Never throws: it's best effort. */
export async function notifyLive(env: Env, username: string, event: LiveEvent): Promise<void> {
  try {
    await env.LIVE.getByName(username.toLowerCase()).broadcast(event);
  } catch (err) {
    console.error("Live update failed", err);
  }
}
