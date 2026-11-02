import { splitAddress } from "./address";

/**
 * Who owns which address, with no config file: on every enabled domain,
 * <username>@domain belongs to that user. Aliases hand out extra local parts
 * and win over a username of the same name, so mail to admin@ keeps reaching
 * whoever holds the alias even if someone called "admin" signs up. Anything
 * left over goes to the domain's catch-all, or nowhere.
 */
export interface Directory {
  /** Enabled domains -> catch-all username (or null). */
  domains: Map<string, string | null>;
  /** "local@domain" for one domain, "local@" for every domain -> username. */
  aliases: Map<string, string>;
}

export interface AliasRow {
  local_part: string;
  domain: string;
  username: string;
}

export interface DomainRow {
  name: string;
  catch_all: string | null;
}

export function buildDirectory(domains: DomainRow[], aliases: AliasRow[]): Directory {
  return {
    domains: new Map(domains.map((d) => [d.name.toLowerCase(), d.catch_all?.toLowerCase() ?? null])),
    aliases: new Map(
      aliases.map((a) => [`${a.local_part.toLowerCase()}@${a.domain.toLowerCase()}`, a.username.toLowerCase()]),
    ),
  };
}

export type Route =
  | { kind: "alias"; owner: string }
  | { kind: "user"; owner: string }
  | { kind: "catch-all"; owner: string }
  | { kind: "none" };

/** `isUser` says whether a local part is a known username. */
export function route(dir: Directory, address: string, isUser: (local: string) => boolean): Route {
  const parts = splitAddress(address);
  if (!parts || !dir.domains.has(parts.domain)) return { kind: "none" };

  const alias = dir.aliases.get(`${parts.local}@${parts.domain}`) ?? dir.aliases.get(`${parts.local}@`);
  if (alias) return { kind: "alias", owner: alias };
  if (isUser(parts.local)) return { kind: "user", owner: parts.local };

  const catchAll = dir.domains.get(parts.domain);
  return catchAll ? { kind: "catch-all", owner: catchAll } : { kind: "none" };
}

/**
 * Every address a user can send from: exactly the ones whose mail reaches
 * them by name or alias (catch-all doesn't count, or the catch-all owner
 * could send as anyone@).
 */
export function addressesOf(dir: Directory, username: string): string[] {
  const user = username.toLowerCase();
  const candidates = new Set<string>();
  for (const domain of dir.domains.keys()) candidates.add(`${user}@${domain}`);
  for (const [key, owner] of dir.aliases) {
    if (owner !== user) continue;
    const [local, domain] = key.split("@") as [string, string];
    if (domain) candidates.add(`${local}@${domain}`);
    else for (const d of dir.domains.keys()) candidates.add(`${local}@${d}`);
  }
  return [...candidates]
    .filter((addr) => {
      const r = route(dir, addr, (local) => local === user);
      return r.kind !== "none" && r.kind !== "catch-all" && r.owner === user;
    })
    .sort();
}
