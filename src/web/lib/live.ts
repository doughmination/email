import { changed, session } from "./state.svelte";

const PING_MS = 30_000;
const MAX_BACKOFF_MS = 60_000;

/**
 * Keeps a WebSocket to /api/live open and reloads the lists when new mail
 * lands. Reconnects with backoff, and catches up on anything missed while it
 * was down.
 */
export function startLive() {
  let ws: WebSocket | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let backoff = 1000;
  let dropped = false;

  function connect() {
    clearTimeout(retry);
    if (ws || document.hidden) return;
    const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/live`);
    ws = socket;
    let ping: ReturnType<typeof setInterval> | undefined;

    socket.onopen = () => {
      backoff = 1000;
      // Cloudflare drops idle sockets after ~100s; the server answers without waking.
      ping = setInterval(() => socket.send("ping"), PING_MS);
      if (dropped) changed();
    };
    socket.onmessage = (e) => {
      if (e.data === "pong") return;
      try {
        const event = JSON.parse(e.data as string) as { type: string; threadId?: string };
        if (event.type !== "mail") return;
        if (event.threadId) session.liveThread = { id: event.threadId, n: (session.liveThread?.n ?? 0) + 1 };
        changed();
      } catch {
        // Not ours; ignore.
      }
    };
    socket.onclose = () => {
      clearInterval(ping);
      if (ws !== socket) return;
      ws = null;
      dropped = true;
      if (document.hidden) return;
      retry = setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    };
  }

  // A background tab doesn't need a socket; reconnect (and catch up) on return.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) return connect();
    clearTimeout(retry);
    if (ws) {
      const socket = ws;
      ws = null;
      dropped = true;
      socket.close();
    }
  });
  addEventListener("online", connect);

  connect();
}
