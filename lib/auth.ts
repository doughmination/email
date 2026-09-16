import { kv } from "./kv";
import { GrantRejected, refreshSession, type Pending, type TokenSet } from "./oidc";

// Sessions live in KV so they can be ended from the server side, and each one
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

function sessionKey(token: string): string {
  return `session:${token}`;
}

async function readSession(token: string): Promise<Session | null> {
  const raw = await kv().get(sessionKey(token));
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as Session;
    if (typeof session?.username === "string" && typeof session.verifiedAt === "number") return session;
  } catch {
    // Sessions from before the SSO move were a bare username; they sign in again.
  }
  await kv().delete(sessionKey(token));
  return null;
}

async function writeSession(token: string, session: Session): Promise<void> {
  const lifetime = session.refreshToken ? SESSION_TTL_S : UNCHECKED_TTL_S;
  const remaining = session.createdAt + lifetime - now();
  if (remaining < 60) {
    await kv().delete(sessionKey(token));
    return;
  }
  await kv().put(sessionKey(token), JSON.stringify(session), { expirationTtl: remaining });
}

export async function createSession(tokens: TokenSet): Promise<string> {
  const token = crypto.randomUUID();
  const ts = now();
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
    await kv().delete(sessionKey(token));
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
        await kv().delete(sessionKey(token));
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
        await kv().delete(sessionKey(token));
        return null;
      }
      console.warn("could not reach the SSO to re-check a session", err);
      if (overdue) {
        await kv().delete(sessionKey(token));
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
  await kv().delete(sessionKey(token));
  return session ? { refreshToken: session.refreshToken, idToken: session.idToken } : null;
}

export async function savePending(p: Pending): Promise<string> {
  const id = crypto.randomUUID();
  await kv().put(`pending:${id}`, JSON.stringify(p), { expirationTtl: PENDING_TTL_S });
  return id;
}

export async function takePending(id: string | undefined): Promise<Pending | null> {
  if (!id) return null;
  const raw = await kv().get(`pending:${id}`, "json");
  if (!raw) return null;
  await kv().delete(`pending:${id}`);
  return raw as Pending;
}
