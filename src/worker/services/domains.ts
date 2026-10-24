import type { DomainInfo } from "../../shared/types";
import { resend } from "./resend";

/**
 * Copies Resend's domain list into D1. New domains arrive switched on; an
 * admin's on/off choice and catch-all survive later syncs. Domains Resend no
 * longer has are kept but marked as not receiving, so they stop routing.
 *
 * Runs from the Admin page, the daily cron and Resend's domain.* webhooks.
 */
export async function syncDomains(env: Env): Promise<{ count: number }> {
  const client = resend(env);
  const seen: { name: string; status: string; receiving: boolean; sending: boolean }[] = [];
  let after: string | undefined;

  // Fetch the whole list before writing anything, so a failed page can't
  // make the rest look deleted.
  for (let page = 0; page < 50; page++) {
    const { data, error } = await client.domains.list({ limit: 100, ...(after ? { after } : {}) });
    if (error || !data) throw new Error(`Could not list Resend domains: ${error?.message}`);
    for (const d of data.data) {
      seen.push({
        name: d.name.toLowerCase(),
        status: d.status,
        receiving: d.capabilities?.receiving === "enabled",
        sending: d.capabilities?.sending === "enabled",
      });
    }
    if (!data.has_more || !data.data.length) break;
    after = data.data[data.data.length - 1]!.id;
  }

  const now = Date.now();
  await env.DB.batch([
    ...seen.map((d) =>
      env.DB.prepare(
        "INSERT INTO domains (name, enabled, catch_all, created_at, receiving, sending, resend_status, synced_at) " +
          "VALUES (?, 1, NULL, ?, ?, ?, ?, ?) ON CONFLICT (name) DO UPDATE SET receiving = excluded.receiving, " +
          "sending = excluded.sending, resend_status = excluded.resend_status, synced_at = excluded.synced_at",
      ).bind(d.name, now, d.receiving ? 1 : 0, d.sending ? 1 : 0, d.status, now),
    ),
    env.DB.prepare(
      "UPDATE domains SET receiving = 0, sending = 0, resend_status = NULL, synced_at = ? " +
        "WHERE synced_at IS NULL OR synced_at < ?",
    ).bind(now, now),
  ]);
  return { count: seen.length };
}

export async function listDomains(env: Env): Promise<DomainInfo[]> {
  const { results } = await env.DB.prepare(
    "SELECT name, enabled, catch_all, receiving, sending, resend_status, synced_at FROM domains ORDER BY name",
  ).all<{
    name: string;
    enabled: number;
    catch_all: string | null;
    receiving: number;
    sending: number;
    resend_status: string | null;
    synced_at: number | null;
  }>();
  return results.map((r) => ({
    name: r.name,
    enabled: r.enabled === 1,
    active: r.enabled === 1 && r.receiving === 1,
    catchAll: r.catch_all,
    syncedAt: r.synced_at,
    resend: r.resend_status
      ? { status: r.resend_status, sending: r.sending === 1, receiving: r.receiving === 1 }
      : null,
  }));
}
