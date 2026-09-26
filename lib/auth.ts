import { db } from "./db";
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

async function deleteSession(token: string): Promise<void> {
  await db().prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
}

async function readSession(token: string): Promise<Session | null> {
  const row = await db()
    .prepare("SELECT data FROM sessions WHERE token = ? AND expires_at > ?")
    .bind(token, now())
    .first<{ data: string }>();
  if (!row) return null;
  const raw = row.data;
  try {
    const session = JSON.parse(raw) as Session;
    if (typeof session?.username === "string" && typeof session.verifiedAt === "number") return session;
  } catch {
    // Sessions from before the SSO move were a bare username; they sign in again.
  }
  await deleteSession(token);
  return null;
}

async function writeSession(token: string, session: Session): Promise<void> {
  const lifetime = session.refreshToken ? SESSION_TTL_S : UNCHECKED_TTL_S;
  const remaining = session.createdAt + lifetime - now();
  if (remaining < 60) {
    await deleteSession(token);
    return;
  }
  await db()
    .prepare(
      "INSERT INTO sessions (token, data, expires_at) VALUES (?, ?, ?) " +
        "ON CONFLICT (token) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at",
    )
    .bind(token, JSON.stringify(session), now() + remaining)
    .run();
}

// D1 has no TTLs, so expired rows are swept whenever someone signs in.
async function sweepExpired(): Promise<void> {
  const ts = now();
  await db().batch([
    db().prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(ts),
    db().prepare("DELETE FROM pending_logins WHERE expires_at <= ?").bind(ts),
  ]);
}

export async function createSession(tokens: TokenSet): Promise<string> {
  const token = crypto.randomUUID();
  const ts = now();
  await sweepExpired();
  await writeSession(token, {
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

async function revalidate(token: string, session: Session): Promise<Session | null> {
  const ts = now();
  if (ts - session.verifiedAt < RECHECK_AFTER_S || !session.refreshToken) return session;

  const overdue = ts - session.verifiedAt > RECHECK_AFTER_S + OUTAGE_GRACE_S;
  if (ts - session.checkedAt < RETRY_AFTER_S) {
    // A recent attempt couldn't reach the SSO; don't retry on every request.
    if (!overdue) return session;
    await deleteSession(token);
    return null;
  }

  // Requests handled by this isolate share one refresh. Other isolates may
  // still race it; the SSO honours a just-used refresh token for a short grace
  // period so that doesn't read as token theft.
  const pending = inflight.get(token);
  if (pending) return pending;

  const task = (async (): Promise<Session | null> => {
    try {
      const fresh = await refreshSession(session.refreshToken!);
      if (fresh.sub && fresh.sub !== session.sub) {
        await deleteSession(token);
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
      await writeSession(token, updated);
      return updated;
    } catch (err) {
      if (err instanceof GrantRejected) {
        await deleteSession(token);
        return null;
      }
      console.warn("could not reach the SSO to re-check a session", err);
      if (overdue) {
        await deleteSession(token);
        return null;
      }
      const updated = { ...session, checkedAt: now() };
      await writeSession(token, updated);
      return updated;
    }
  })().finally(() => inflight.delete(token));

  inflight.set(token, task);
  return task;
}

export async function isValidSession(token: string | undefined): Promise<boolean> {
  return (await sessionUser(token)) !== null;
}

export async function sessionUser(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  const session = await readSession(token);
  if (!session) return null;
  return (await revalidate(token, session))?.username ?? null;
}

/** Deletes the session and hands back what's needed to end it at the SSO too. */
export async function destroySession(
  token: string | undefined,
): Promise<{ refreshToken: string | null; idToken: string | null } | null> {
  if (!token) return null;
  const session = await readSession(token);
  await deleteSession(token);
  return session ? { refreshToken: session.refreshToken, idToken: session.idToken } : null;
}

export async function savePending(p: Pending): Promise<string> {
  const id = crypto.randomUUID();
  await db()
    .prepare("INSERT INTO pending_logins (id, data, expires_at) VALUES (?, ?, ?)")
    .bind(id, JSON.stringify(p), now() + PENDING_TTL_S)
    .run();
  return id;
}

export async function takePending(id: string | undefined): Promise<Pending | null> {
  if (!id) return null;
  const row = await db()
    .prepare("DELETE FROM pending_logins WHERE id = ? RETURNING data, expires_at")
    .bind(id)
    .first<{ data: string; expires_at: number }>();
  if (!row || row.expires_at <= now()) return null;
  return JSON.parse(row.data) as Pending;
}
