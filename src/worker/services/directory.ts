import { bareAddress } from "../lib/address";
import { addressesOf, buildDirectory, route, type AliasRow, type Directory, type DomainRow } from "../lib/routing";
import type { TokenSet } from "./oidc";

// Read per request rather than cached per isolate: an admin's change has to
// apply everywhere at once. Both tables stay tiny.
export async function loadDirectory(env: Env): Promise<Directory> {
  const [domains, aliases] = await env.DB.batch([
    env.DB.prepare("SELECT name, catch_all FROM domains WHERE enabled = 1 AND receiving = 1"),
    env.DB.prepare("SELECT local_part, domain, username FROM aliases"),
  ]);
  return buildDirectory((domains?.results ?? []) as DomainRow[], (aliases?.results ?? []) as AliasRow[]);
}

async function existingUsers(env: Env, names: string[]): Promise<Set<string>> {
  if (!names.length) return new Set();
  const { results } = await env.DB.prepare(
    `SELECT username FROM users WHERE username IN (${names.map(() => "?").join(", ")})`,
  )
    .bind(...names)
    .all<{ username: string }>();
  return new Set(results.map((r) => r.username.toLowerCase()));
}

/**
 * Which mailboxes an inbound email lands in, each with the recipient address
 * that put it there. One email to clove@ and ari@ is delivered to both.
 */
export async function routeRecipients(env: Env, recipients: string[]): Promise<Map<string, string>> {
  const dir = await loadDirectory(env);
  const addrs = [...new Set(recipients.map(bareAddress).filter(Boolean))];
  const users = await existingUsers(env, [...new Set(addrs.map((a) => a.split("@")[0] ?? ""))]);

  const byOwner = new Map<string, string>();
  for (const addr of addrs) {
    const r = route(dir, addr, (local) => users.has(local));
    if (r.kind !== "none" && !byOwner.has(r.owner)) byOwner.set(r.owner, addr);
  }
  return byOwner;
}

export async function addressesFor(env: Env, username: string): Promise<string[]> {
  return addressesOf(await loadDirectory(env), username);
}

/** The owned address matching `requested`, or null if they can't send as it. */
export async function ownedAddress(env: Env, username: string, requested: string): Promise<string | null> {
  const bare = bareAddress(requested);
  return (await addressesFor(env, username)).find((a) => a === bare) ?? null;
}

export async function enabledDomains(env: Env): Promise<string[]> {
  return [...(await loadDirectory(env)).domains.keys()].sort();
}

export class AccountConflict extends Error {}

function bootstrapAdmins(env: Env): Set<string> {
  return new Set(
    (env.ADMIN_USERS || "")
      .split(/[,\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Records a sign-in. Users in ADMIN_USERS are made admins every time, so the
 * first admin needs no setup and can't lock themselves out from the UI.
 */
export async function recordLogin(env: Env, tokens: TokenSet): Promise<void> {
  const username = tokens.username.toLowerCase();
  const ts = Date.now();
  const admin = bootstrapAdmins(env).has(username) ? 1 : 0;
  // One statement, so two sign-ins racing can't both get past a separate check:
  // an existing row is only touched when it's the same SSO account.
  const res = await env.DB.prepare(
    "INSERT INTO users (username, sub, is_admin, created_at, last_login_at) VALUES (?, ?, ?, ?, ?) " +
      "ON CONFLICT (username) DO UPDATE SET last_login_at = excluded.last_login_at, " +
      "is_admin = MAX(users.is_admin, excluded.is_admin) WHERE users.sub = excluded.sub",
  )
    .bind(username, tokens.sub, admin, ts, ts)
    .run();
  if (res.meta.changes === 0) {
    throw new AccountConflict(`username ${username} already belongs to a different SSO account`);
  }
}

export async function getUser(
  env: Env,
  username: string,
): Promise<{ username: string; sub: string; isAdmin: boolean } | null> {
  const row = await env.DB.prepare("SELECT username, sub, is_admin FROM users WHERE username = ?")
    .bind(username.toLowerCase())
    .first<{ username: string; sub: string; is_admin: number }>();
  return row ? { username: row.username, sub: row.sub, isAdmin: row.is_admin === 1 } : null;
}
