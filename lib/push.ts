import { db } from "./db";
import { sendWebPush, type PushSubscription, type VapidKeys } from "./webpush";

function vapid(): VapidKeys {
  return {
    public: process.env.VAPID_PUBLIC_KEY ?? "",
    private: process.env.VAPID_PRIVATE_KEY ?? "",
    subject: process.env.VAPID_SUBJECT ?? "mailto:admin@localhost",
  };
}

export function pushConfigured(): boolean {
  const v = vapid();
  return Boolean(v.public && v.private);
}

export function vapidPublicKey(): string {
  return vapid().public;
}

export type PushPayload = { title: string; body: string; url?: string; tag?: string };

function isSubscription(x: unknown): x is PushSubscription {
  if (!x || typeof x !== "object") return false;
  const s = x as Record<string, unknown>;
  return typeof s.endpoint === "string" && !!s.keys && typeof s.keys === "object";
}

export async function addSubscription(sub: PushSubscription): Promise<void> {
  if (!isSubscription(sub)) throw new Error("Invalid subscription");
  await db()
    .prepare(
      "INSERT INTO push_subscriptions (endpoint, data) VALUES (?, ?) " +
        "ON CONFLICT (endpoint) DO UPDATE SET data = excluded.data",
    )
    .bind(sub.endpoint, JSON.stringify(sub))
    .run();
}

export async function removeSubscription(endpoint: string): Promise<void> {
  await db().prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(endpoint).run();
}

export async function listSubscriptions(): Promise<PushSubscription[]> {
  const { results } = await db().prepare("SELECT data FROM push_subscriptions").all<{ data: string }>();
  return results.map((r) => JSON.parse(r.data) as unknown).filter(isSubscription);
}

export async function subscriptionCount(): Promise<number> {
  const row = await db().prepare("SELECT COUNT(*) AS n FROM push_subscriptions").first<{ n: number }>();
  return row?.n ?? 0;
}

export async function sendToAll(payload: PushPayload): Promise<{ sent: number; pruned: number }> {
  const keys = vapid();
  if (!keys.public || !keys.private) return { sent: 0, pruned: 0 };

  const subs = await listSubscriptions();
  const data = JSON.stringify(payload);
  const dead: string[] = [];
  let sent = 0;

  await Promise.all(
    subs.map(async (sub) => {
      try {
        const res = await sendWebPush(sub, data, keys);
        if (res.status >= 200 && res.status < 300) {
          sent++;
        } else if (res.status === 404 || res.status === 410) {
          dead.push(sub.endpoint);
        } else {
          console.error("Push send failed", res.status, await res.text().catch(() => ""));
        }
      } catch (err) {
        console.error("Push send error", err);
      }
    }),
  );

  for (const endpoint of dead) await removeSubscription(endpoint);
  return { sent, pruned: dead.length };
}
