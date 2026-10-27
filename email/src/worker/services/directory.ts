import { bareAddress } from "../lib/address";
import { chunks } from "../lib/chunk";
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
  const found = await env.DB.batch<{ username: string }>(
    chunks(names).map((slice) =>
      env.DB.prepare(`SELECT username FROM users WHERE username IN (${slice.map(() => "?").join(", ")})`).bind(
        ...slice,
      ),
    ),
  );
  return new Set(found.flatMap((r) => r.results.map((row) => row.username.toLowerCase())));
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
export class ReservedUsername extends Error {}

// RFC 2142 role mailboxes and other names mail gets sent to blind. Signing up
// as one would take its mail on every domain, and let you send as it. Hand
// them out as aliases instead.
const RESERVED = new Set([
  "abuse",
  "admin",
  "administrator",
  "billing",
  "hostmaster",
  "info",
  "mailer-daemon",
  "marketing",
  "no-reply",
  "noc",
  "noreply",
  "postmaster",
  "root",
  "sales",
  "security",
  "support",
  "webmaster",
]);

function bootstrapAdmins(env: Env): Set<string> {
  return new Set(
    (env.ADMIN_USERS || "")
      .split(/[,\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export async function displayName(env: Env, username: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT display_name FROM users WHERE username = ?")
    .bind(username)
    .first<{ display_name: string | null }>();
  return row?.display_name ?? null;
}

export async function setDisplayName(env: Env, username: string, name: string | null): Promise<void> {
  await env.DB.prepare("UPDATE users SET display_name = ? WHERE username = ?").bind(name, username).run();
}

/**
 * Records a sign-in and returns the username it signs in as.
 *
 * The SSO account (sub) is the identity, not the name: someone renamed on the
 * SSO keeps the mailbox and addresses they already have here. A new account
 * gets the SSO's username, unless it's reserved or already someone else's.
 *
 * Users in ADMIN_USERS are re-made admins on every sign-in, so they can't be
 * locked out from the UI. A *new* account only becomes one while there's no
 * admin at all; otherwise whoever registered a listed name first on the SSO
 * (after the real one was deleted, say) would walk in as an admin.
 *
 * The SSO's name only fills in a missing display name, so one set in Settings sticks.
 */
export async function recordLogin(env: Env, tokens: TokenSet): Promise<string> {
  const ts = Date.now();
  const admins = bootstrapAdmins(env);

  const known = await env.DB.prepare("SELECT username FROM users WHERE sub = ?")
    .bind(tokens.sub)
    .first<{ username: string }>();
  if (known) {
    await env.DB.prepare(
      "UPDATE users SET last_login_at = ?, is_admin = MAX(is_admin, ?), display_name = COALESCE(display_name, ?) " +
        "WHERE sub = ?",
    )
      .bind(ts, admins.has(known.username.toLowerCase()) ? 1 : 0, tokens.name ?? null, tokens.sub)
      .run();
    return known.username;
  }

  const username = tokens.username.toLowerCase();
  if (RESERVED.has(username)) throw new ReservedUsername(`${username} is reserved`);
  // One statement, so two sign-ins racing for a name can't both get it.
  const res = await env.DB.prepare(
    "INSERT INTO users (username, sub, is_admin, display_name, created_at, last_login_at) " +
      "SELECT ?1, ?2, ?3 AND NOT EXISTS (SELECT 1 FROM users WHERE is_admin = 1), ?4, ?5, ?5 WHERE true " +
      "ON CONFLICT DO NOTHING",
  )
    .bind(username, tokens.sub, admins.has(username) ? 1 : 0, tokens.name ?? null, ts)
    .run();
  if (res.meta.changes === 0) {
    throw new AccountConflict(`username ${username} already belongs to a different SSO account`);
  }
  return username;
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
