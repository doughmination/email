<!-- mailbox/src/web/pages/Admin.svelte
     Copyright (c) 2026 Clove Nytrix Doughmination Twilight
     Licensed under the DASL-1.0 Licence.
     See LICENCE.md in the project root for full licence information. -->
<script lang="ts">
  import Globe from "@lucide/svelte/icons/globe";
  import Plus from "@lucide/svelte/icons/plus";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Trash from "@lucide/svelte/icons/trash";
  import type { AliasInfo, DomainInfo, UserInfo } from "../../shared/types";
  import { api } from "../lib/api";
  import { loadSession, session } from "../lib/state.svelte";

  let domains = $state<DomainInfo[]>([]);
  let aliases = $state<AliasInfo[]>([]);
  let users = $state<UserInfo[]>([]);
  let error = $state("");
  let newAlias = $state<AliasInfo>({ localPart: "", domain: "", username: "" });
  /** Username typed to confirm deleting that user. */
  let deleting = $state<{ username: string; typed: string } | null>(null);

  let syncError = $state<string | null>(null);
  let syncing = $state(false);

  async function load() {
    syncing = true;
    try {
      let synced;
      [synced, aliases, users] = await Promise.all([api.admin.domains(), api.admin.aliases(), api.admin.users()]);
      ({ domains, syncError } = synced);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      syncing = false;
    }
  }

  function domainState(d: DomainInfo): string {
    if (!d.resend) return "removed from Resend";
    if (!d.resend.receiving) return "receiving off in Resend";
    if (!d.enabled) return "switched off here";
    return d.resend.sending ? "receiving + sending" : "receiving only; sending off in Resend";
  }

  /**
   * Runs a change, then refreshes this page and the user's own addresses,
   * even if the change failed, so a checkbox or dropdown snaps back to what's
   * really saved. The action's own error is the one shown.
   */
  async function act(fn: () => Promise<unknown>) {
    error = "";
    let failure = "";
    try {
      await fn();
    } catch (e) {
      failure = (e as Error).message;
    } finally {
      await Promise.all([load(), loadSession().catch(() => {})]);
      if (failure) error = failure;
    }
  }

  $effect(() => {
    void load();
  });
</script>

<div class="page">
  <h1>Admin</h1>
  {#if error}<p class="error">{error}</p>{/if}

  <section>
    <h2>
      <Globe size={16} /> Domains
      <button class="btn icon sync" title="Sync with Resend" onclick={() => act(async () => {})} disabled={syncing}>
        <RefreshCw size={14} class={syncing ? "spin" : ""} />
      </button>
    </h2>
    <p class="muted">
      Every domain in your Resend account appears here and is switched on automatically. Each user gets
      &lt;username&gt;@ on every active domain. Add a domain in Resend and turn on receiving there; it shows up here on
      the next sync.
    </p>
    {#if syncError}<p class="error">{syncError}</p>{/if}
    {#if !domains.length && !syncing}
      <p class="muted">No domains in Resend yet.</p>
    {/if}
    <table>
      <thead><tr><th>Domain</th><th>Status</th><th>On</th><th>Catch-all</th></tr></thead>
      <tbody>
        {#each domains as d (d.name)}
          <tr class:inactive={!d.active}>
            <td>{d.name}</td>
            <td class="muted">{domainState(d)}</td>
            <td>
              <input
                type="checkbox"
                checked={d.enabled}
                disabled={!d.resend}
                onchange={(e) => act(() => api.admin.saveDomain(d.name, e.currentTarget.checked, d.catchAll))}
              />
            </td>
            <td>
              <select class="input"
                value={d.catchAll ?? ""}
                onchange={(e) => act(() => api.admin.saveDomain(d.name, d.enabled, e.currentTarget.value || null))}
              >
                <option value="">Drop unknown addresses</option>
                {#each users as u (u.username)}<option value={u.username}>{u.name ? `${u.name} (${u.username})` : u.username}</option>{/each}
              </select>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>

  <section>
    <h2>Aliases</h2>
    <p class="muted">Extra addresses for a user. An alias on "every domain" applies to all enabled ones.</p>
    <table>
      <tbody>
        {#each aliases as a (`${a.localPart}@${a.domain}`)}
          <tr>
            <td>{a.localPart}@{a.domain || "every domain"}</td>
            <td>→ {a.username}</td>
            <td>
              <button class="btn icon danger" title="Remove" onclick={() => act(() => api.admin.deleteAlias(a))}>
                <Trash size={14} />
              </button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
    <form
      class="row"
      onsubmit={(e) => {
        e.preventDefault();
        void act(async () => {
          await api.admin.addAlias(newAlias);
          newAlias = { localPart: "", domain: "", username: "" };
        });
      }}
    >
      <input class="input" bind:value={newAlias.localPart} placeholder="ctf" required />
      <span>@</span>
      <select class="input" bind:value={newAlias.domain}>
        <option value="">every domain</option>
        {#each domains.filter((d) => d.active) as d (d.name)}<option value={d.name}>{d.name}</option>{/each}
      </select>
      <span>→</span>
      <select class="input" bind:value={newAlias.username} required>
        <option value="" disabled>user</option>
        {#each users as u (u.username)}<option value={u.username}>{u.name ? `${u.name} (${u.username})` : u.username}</option>{/each}
      </select>
      <button class="btn"><Plus size={14} /> Add</button>
    </form>
  </section>

  <section>
    <h2>Users</h2>
    <p class="muted">Anyone the SSO lets in appears here after their first sign-in.</p>
    <table>
      <thead><tr><th>User</th><th>Mail</th><th>Admin</th><th></th></tr></thead>
      <tbody>
        {#each users as u (u.username)}
          <tr>
            <td>
              {#if u.name}<strong>{u.name}</strong> <span class="muted">({u.username})</span>{:else}{u.username}{/if}
              <div class="muted small">{u.addresses.join(", ")}</div>
            </td>
            <td>{u.messageCount}</td>
            <td>
              <input
                type="checkbox"
                checked={u.isAdmin}
                disabled={u.username === session.me?.username}
                onchange={(e) => act(() => api.admin.setAdmin(u.username, e.currentTarget.checked))}
              />
            </td>
            <td>
              {#if u.username !== session.me?.username}
                <button class="btn icon danger" title="Delete user" onclick={() => (deleting = { username: u.username, typed: "" })}>
                  <Trash size={14} />
                </button>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>

    {#if deleting}
      {@const target = deleting}
      <div class="confirm">
        <p>
          This permanently deletes <strong>{target.username}</strong> and all
          {users.find((u) => u.username === target.username)?.messageCount ?? 0} of their messages. Type their username
          to confirm.
        </p>
        <input class="input" bind:value={target.typed} />
        <button
          class="btn danger"
          disabled={target.typed !== target.username}
          onclick={() =>
            act(async () => {
              await api.admin.deleteUser(target.username);
              deleting = null;
            })}>Delete</button
        >
        <button class="btn" onclick={() => (deleting = null)}>Cancel</button>
      </div>
    {/if}
  </section>
</div>

<style>
  .page {
    grid-column: 2 / -1;
    overflow-y: auto;
    padding: 0.5rem 0.25rem;
  }

  h1 {
    margin: 0.5rem 0 1.25rem;
    font-size: clamp(1.75rem, 4vw, 2.5rem);
    font-weight: 700;
    letter-spacing: -0.03em;
  }

  section {
    max-width: 900px;
    margin-bottom: 1rem;
    padding: 1.25rem 1.5rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--panel);
    backdrop-filter: blur(14px);
    overflow-x: auto;
  }

  h2 {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0 0 0.5rem;
    color: var(--accent);
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .sync {
    margin-left: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
  }

  th,
  td {
    padding: 0.5rem 0.6rem;
    border-bottom: 1px solid var(--line);
    text-align: left;
    vertical-align: top;
  }

  tr:last-child td {
    border-bottom: none;
  }

  th {
    color: var(--muted);
    font-size: 0.65rem;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  tr.inactive td:first-child {
    color: var(--muted);
    text-decoration: line-through;
  }

  .small {
    font-size: 0.75rem;
  }

  input[type="checkbox"] {
    accent-color: var(--accent);
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.9rem;
  }

  .confirm {
    margin-top: 1rem;
    padding: 1rem 1.25rem;
    border: 1px solid rgb(255 92 122 / 40%);
    border-radius: var(--radius-sm);
    background: rgb(255 92 122 / 6%);
  }
</style>
