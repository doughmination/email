import { SignJWT, importPKCS8 } from "jose";

/**
 * Notifications for the Android app, through Firebase Cloud Messaging's HTTP
 * v1 API. FCM_SERVICE_ACCOUNT holds the Firebase service account's JSON key;
 * without it, FCM is simply off.
 */
interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

export type FcmMessage = { title: string; body: string; url?: string; tag?: string };

function account(env: Env): ServiceAccount | null {
  if (!env.FCM_SERVICE_ACCOUNT) return null;
  const parsed = JSON.parse(env.FCM_SERVICE_ACCOUNT) as Partial<ServiceAccount>;
  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
    throw new Error("FCM_SERVICE_ACCOUNT is missing project_id, client_email or private_key");
  }
  return parsed as ServiceAccount;
}

// Google's access tokens last an hour; one per isolate is reused until close to that.
let cached: { email: string; token: string; expiresAt: number } | null = null;

async function accessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.email === sa.client_email && cached.expiresAt - 60 > now) return cached.token;

  const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/firebase.messaging" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(sa.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(await importPKCS8(sa.private_key, "RS256"));

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!res.ok) throw new Error(`Google token request failed (${res.status}): ${await res.text()}`);
  const { access_token, expires_in } = (await res.json()) as { access_token: string; expires_in: number };
  cached = { email: sa.client_email, token: access_token, expiresAt: now + expires_in };
  return access_token;
}

// Every new email fans out one request per device, so cap them, as for Web Push.
export const MAX_FCM_TOKENS = 20;

/** Returns false when the user already has MAX_FCM_TOKENS other devices. */
export async function addFcmToken(env: Env, username: string, token: string): Promise<boolean> {
  // A token re-registered by someone else (the phone changed hands) moves to them.
  const res = await env.DB.prepare(
    "INSERT INTO fcm_tokens (token, username, created_at) SELECT ?1, ?2, ?3 " +
      "WHERE (SELECT COUNT(*) FROM fcm_tokens WHERE username = ?2 AND token != ?1) < ?4 " +
      "ON CONFLICT (token) DO UPDATE SET username = excluded.username",
  )
    .bind(token, username, Date.now(), MAX_FCM_TOKENS)
    .run();
  return res.meta.changes > 0;
}

export async function removeFcmToken(env: Env, username: string, token: string): Promise<void> {
  await env.DB.prepare("DELETE FROM fcm_tokens WHERE token = ? AND username = ?").bind(token, username).run();
}

/** Sends to every app install `username` has; drops tokens FCM says are gone. */
export async function notifyFcm(env: Env, username: string, msg: FcmMessage): Promise<{ sent: number; pruned: number }> {
  const sa = account(env);
  if (!sa) return { sent: 0, pruned: 0 };
  const { results } = await env.DB.prepare("SELECT token FROM fcm_tokens WHERE username = ?")
    .bind(username)
    .all<{ token: string }>();
  if (!results.length) return { sent: 0, pruned: 0 };

  const bearer = await accessToken(sa);
  const url = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;
  // Data-only, so the app builds the notification itself and a tap opens the thread.
  const data = Object.fromEntries(Object.entries(msg).filter(([, v]) => v !== undefined)) as Record<string, string>;
  const dead: string[] = [];
  let sent = 0;

  await Promise.all(
    results.map(async ({ token }) => {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
          body: JSON.stringify({ message: { token, data, android: { priority: "HIGH", ttl: "86400s" } } }),
        });
        if (res.ok) return void sent++;
        const text = await res.text();
        // UNREGISTERED: the app was uninstalled or its token rotated.
        if (res.status === 404 || text.includes("UNREGISTERED")) dead.push(token);
        else console.error("FCM send failed", res.status, text);
      } catch (err) {
        console.error("FCM send error", err);
      }
    }),
  );

  if (dead.length) {
    await env.DB.batch(dead.map((t) => env.DB.prepare("DELETE FROM fcm_tokens WHERE token = ?").bind(t)));
  }
  return { sent, pruned: dead.length };
}
