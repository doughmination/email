import { notifyFcm } from "./fcm";
import { sendWebPush, type PushSubscription, type VapidKeys } from "./webpush";

function vapid(env: Env): VapidKeys | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null;
  return {
    public: env.VAPID_PUBLIC_KEY,
    private: env.VAPID_PRIVATE_KEY,
    subject: env.VAPID_SUBJECT || "mailto:admin@localhost",
  };
}

export function pushPublicKey(env: Env): string | null {
  return vapid(env)?.public ?? null;
}

export type PushPayload = { title: string; body: string; url?: string; tag?: string };

// Every new email fans out one request per device, so cap them.
export const MAX_SUBSCRIPTIONS = 20;

/** Returns false when the user already has MAX_SUBSCRIPTIONS other devices. */
export async function addSubscription(env: Env, username: string, sub: PushSubscription): Promise<boolean> {
  // Re-subscribing a device that was someone else's hands it over.
  const res = await env.DB.prepare(
    "INSERT INTO push_subscriptions (endpoint, username, data) SELECT ?1, ?2, ?3 " +
      "WHERE (SELECT COUNT(*) FROM push_subscriptions WHERE username = ?2 AND endpoint != ?1) < ?4 " +
      "ON CONFLICT (endpoint) DO UPDATE SET username = excluded.username, data = excluded.data",
  )
    .bind(sub.endpoint, username, JSON.stringify(sub), MAX_SUBSCRIPTIONS)
    .run();
  return res.meta.changes > 0;
}

export async function removeSubscription(env: Env, username: string, endpoint: string): Promise<void> {
  await env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND username = ?")
    .bind(endpoint, username)
    .run();
}

/**
 * Notifies every device `username` has: browsers through Web Push, the
 * Android app through FCM. Drops ones the push service says are gone.
 */
export async function notifyUser(
  env: Env,
  username: string,
  payload: PushPayload,
): Promise<{ sent: number; pruned: number }> {
  const [web, app] = await Promise.all([
    notifyWebPush(env, username, payload),
    // A broken FCM setup mustn't stop browsers getting theirs.
    notifyFcm(env, username, payload).catch((err) => {
      console.error("FCM notify failed", err);
      return { sent: 0, pruned: 0 };
    }),
  ]);
  return { sent: web.sent + app.sent, pruned: web.pruned + app.pruned };
}

async function notifyWebPush(env: Env, username: string, payload: PushPayload): Promise<{ sent: number; pruned: number }> {
  const keys = vapid(env);
  if (!keys) return { sent: 0, pruned: 0 };

  const { results } = await env.DB.prepare("SELECT data FROM push_subscriptions WHERE username = ?")
    .bind(username)
    .all<{ data: string }>();
  const data = JSON.stringify(payload);
  const dead: string[] = [];
  let sent = 0;

  await Promise.all(
    results.map(async (row) => {
      const sub = JSON.parse(row.data) as PushSubscription;
      try {
        const res = await sendWebPush(sub, data, keys);
        if (res.ok) sent++;
        else if (res.status === 404 || res.status === 410) dead.push(sub.endpoint);
        else console.error("Push send failed", res.status, await res.text().catch(() => ""));
      } catch (err) {
        console.error("Push send error", err);
      }
    }),
  );

  if (dead.length) {
    await env.DB.batch(dead.map((e) => env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(e)));
  }
  return { sent, pruned: dead.length };
}
