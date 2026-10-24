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

export async function addSubscription(env: Env, username: string, sub: PushSubscription): Promise<void> {
  // Re-subscribing a device that was someone else's hands it over.
  await env.DB.prepare(
    "INSERT INTO push_subscriptions (endpoint, username, data) VALUES (?, ?, ?) " +
      "ON CONFLICT (endpoint) DO UPDATE SET username = excluded.username, data = excluded.data",
  )
    .bind(sub.endpoint, username, JSON.stringify(sub))
    .run();
}

export async function removeSubscription(env: Env, username: string, endpoint: string): Promise<void> {
  await env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND username = ?")
    .bind(endpoint, username)
    .run();
}

/** Notifies every device `username` has subscribed; drops ones the push service says are gone. */
export async function notifyUser(
  env: Env,
  username: string,
  payload: PushPayload,
): Promise<{ sent: number; pruned: number }> {
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
