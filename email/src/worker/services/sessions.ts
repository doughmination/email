import { GrantRejected, refreshSession, type Pending, type TokenSet } from "./oidc";

// Sessions live in D1 so they can be ended from the server side, and each one
// keeps the SSO's refresh token so it can be re-checked: an account that's
// disabled or taken out of this app's allowed groups on the SSO is signed out
// here within RECHECK_AFTER_S.
export const SESSION_TTL_S = 60 * 60 * 24 * 30;
const RECHECK_AFTER_S = 60 * 10;
const OUTAGE_GRACE_S = 60 * 60;
const RETRY_AFTER_S = 60;
const UNCHECKED_TTL_S = 60 * 60 * 24;
const PENDING_TTL_S = 60 * 10;

interface Session {
  username: string;
  sub: string;
  refreshToken: string | null;
  idToken: string | null;
  createdAt: number;
  verifiedAt: number;
  checkedAt: number;
}

const now = () => Math.floor(Date.now() / 1000);

async function deleteSession(env: Env, token: string): Promise<void> {
  await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
}

async function readSession(env: Env, token: string): Promise<Session | null> {
  const row = await env.DB.prepare("SELECT data FROM sessions WHERE token = ? AND expires_at > ?")
    .bind(token, now())
    .first<{ data: string }>();
  if (!row) return null;
  try {
    const session = JSON.parse(row.data) as Session;
    if (typeof session?.username === "string" && typeof session.verifiedAt === "number") return session;
  } catch {
    // Unreadable row; treat it as signed out.
  }
  await deleteSession(env, token);
  return null;
}

async function writeSession(env: Env, token: string, session: Session): Promise<void> {
  const lifetime = session.refreshToken ? SESSION_TTL_S : UNCHECKED_TTL_S;
  const remaining = session.createdAt + lifetime - now();
  if (remaining < 60) {
    await deleteSession(env, token);
    return;
  }
  await env.DB.prepare(
    "INSERT INTO sessions (token, data, expires_at) VALUES (?, ?, ?) " +
      "ON CONFLICT (token) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at",
  )
    .bind(token, JSON.stringify(session), now() + remaining)
    .run();
}

/** D1 has no TTLs; the daily cron calls this. */
export async function sweepExpired(env: Env): Promise<void> {
  const ts = now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(ts),
    env.DB.prepare("DELETE FROM pending_logins WHERE expires_at <= ?").bind(ts),
  ]);
}

export async function createSession(env: Env, tokens: TokenSet): Promise<string> {
  const token = crypto.randomUUID();
  const ts = now();
  await writeSession(env, token, {
    username: tokens.username,
    sub: tokens.sub,
    refreshToken: tokens.refreshToken,
    idToken: tokens.idToken,
    createdAt: ts,
    verifiedAt: ts,
    checkedAt: ts,
  });
  return token;
}

const inflight = new Map<string, Promise<Session | null>>();

async function revalidate(env: Env, token: string, session: Session): Promise<Session | null> {
  const ts = now();
  if (ts - session.verifiedAt < RECHECK_AFTER_S || !session.refreshToken) return session;

  const overdue = ts - session.verifiedAt > RECHECK_AFTER_S + OUTAGE_GRACE_S;
  if (ts - session.checkedAt < RETRY_AFTER_S) {
    // A recent attempt couldn't reach the SSO; don't retry on every request.
    if (!overdue) return session;
    await deleteSession(env, token);
    return null;
  }

  // Requests handled by this isolate share one refresh. Other isolates may
  // still race it; the SSO honours a just-used refresh token for a short grace
  // period so that doesn't read as token theft.
  const pending = inflight.get(token);
  if (pending) return pending;

  const task = (async (): Promise<Session | null> => {
    try {
      const fresh = await refreshSession(env, session.refreshToken!);
      if (fresh.sub && fresh.sub !== session.sub) {
        await deleteSession(env, token);
        return null;
      }
      const at = now();
      const updated: Session = {
        ...session,
        refreshToken: fresh.refreshToken ?? session.refreshToken,
        idToken: fresh.idToken ?? session.idToken,
        verifiedAt: at,
        checkedAt: at,
      };
      await writeSession(env, token, updated);
      return updated;
    } catch (err) {
      if (err instanceof GrantRejected) {
        await deleteSession(env, token);
        return null;
      }
      console.warn("could not reach the SSO to re-check a session", err);
      if (overdue) {
        await deleteSession(env, token);
        return null;
      }
      const updated = { ...session, checkedAt: now() };
      await writeSession(env, token, updated);
      return updated;
    }
  })().finally(() => inflight.delete(token));

  inflight.set(token, task);
  return task;
}

/** Who a session belongs to: the username and the SSO account (sub) behind it. */
export async function sessionIdentity(
  env: Env,
  token: string | undefined,
): Promise<{ username: string; sub: string } | null> {
  if (!token) return null;
  const session = await readSession(env, token);
  if (!session) return null;
  const valid = await revalidate(env, token, session);
  return valid ? { username: valid.username, sub: valid.sub } : null;
}

/** Deletes the session and hands back what's needed to end it at the SSO too. */
export async function destroySession(
  env: Env,
  token: string | undefined,
): Promise<{ refreshToken: string | null; idToken: string | null } | null> {
  if (!token) return null;
  const session = await readSession(env, token);
  await deleteSession(env, token);
  return session ? { refreshToken: session.refreshToken, idToken: session.idToken } : null;
}

export async function savePending(env: Env, p: Pending): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO pending_logins (id, data, expires_at) VALUES (?, ?, ?)")
    .bind(id, JSON.stringify(p), now() + PENDING_TTL_S)
    .run();
  return id;
}

export async function takePending(env: Env, id: string | undefined): Promise<Pending | null> {
  if (!id) return null;
  const row = await env.DB.prepare("DELETE FROM pending_logins WHERE id = ? RETURNING data, expires_at")
    .bind(id)
    .first<{ data: string; expires_at: number }>();
  if (!row || row.expires_at <= now()) return null;
  return JSON.parse(row.data) as Pending;
}
