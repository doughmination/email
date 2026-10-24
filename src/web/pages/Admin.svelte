<!-- mailbox/src/web/pages/Admin.svelte
     Copyright (c) 2026 Clove Nytrix Doughmination Twilight
     Licensed under the DASL-1.0 Licence.
     See LICENCE.md in the project root for full licence information. -->
<script lang="ts">
  import Globe from "@lucide/svelte/icons/globe";
  import Plus from "@lucide/svelte/icons/plus";
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

  async function load() {
    try {
      [domains, aliases, users] = await Promise.all([api.admin.domains(), api.admin.aliases(), api.admin.users()]);
    } catch (e) {
      error = (e as Error).message;
    }
  }

  /** Runs a change, then refreshes this page and the user's own addresses. */
  async function act(fn: () => Promise<unknown>) {
    error = "";
    try {
      await fn();
      await Promise.all([load(), loadSession()]);
    } catch (e) {
      error = (e as Error).message;
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
    <h2><Globe size={16} /> Domains</h2>
    <p class="muted">
      Every user gets &lt;username&gt;@ on each enabled domain. Domains come from Resend; set up receiving there first.
    </p>
    <table>
      <thead><tr><th>Domain</th><th>Resend</th><th>Enabled</th><th>Catch-all</th></tr></thead>
      <tbody>
        {#each domains as d (d.name)}
          <tr>
            <td>{d.name}</td>
            <td class="muted">
              {#if d.resend}
                {d.resend.status}{d.resend.receiving ? "" : " · receiving off"}{d.resend.sending ? "" : " · sending off"}
              {:else}
                not in Resend
              {/if}
            </td>
            <td>
              <input
                type="checkbox"
                checked={d.enabled}
                onchange={(e) => act(() => api.admin.saveDomain(d.name, e.currentTarget.checked, d.catchAll))}
              />
            </td>
            <td>
              <select
                value={d.catchAll ?? ""}
                onchange={(e) => act(() => api.admin.saveDomain(d.name, d.enabled, e.currentTarget.value || null))}
              >
                <option value="">Drop unknown addresses</option>
                {#each users as u (u.username)}<option value={u.username}>{u.username}</option>{/each}
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
      <input bind:value={newAlias.localPart} placeholder="ctf" required />
      <span>@</span>
      <select bind:value={newAlias.domain}>
        <option value="">every domain</option>
        {#each domains.filter((d) => d.enabled) as d (d.name)}<option value={d.name}>{d.name}</option>{/each}
      </select>
      <span>→</span>
      <select bind:value={newAlias.username} required>
        <option value="" disabled>user</option>
        {#each users as u (u.username)}<option value={u.username}>{u.username}</option>{/each}
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
              {u.username}
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
        <input bind:value={target.typed} />
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
    padding: 1.5rem;
    overflow-y: auto;
  }

  h1 {
    font-size: 1.1rem;
  }

  section {
    margin-bottom: 1.5rem;
    padding: 1rem;
    max-width: 900px;
    background: var(--mantle);
    border: 2px solid var(--surface1);
    box-shadow: var(--shadow-hard);
    overflow-x: auto;
  }

  h2 {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0;
    font-size: 0.9rem;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
  }

  th,
  td {
    padding: 0.4rem 0.5rem;
    border-bottom: 1px solid var(--surface1);
    text-align: left;
    vertical-align: top;
  }

  th {
    color: var(--subtext0);
    font-weight: 400;
    text-transform: uppercase;
    font-size: 0.7rem;
    letter-spacing: 0.06em;
  }

  .small {
    font-size: 0.75rem;
  }

  input:not([type="checkbox"]),
  select {
    padding: 0.35rem 0.5rem;
    background: var(--crust);
    border: 2px solid var(--surface1);
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.75rem;
  }

  .confirm {
    margin-top: 1rem;
    padding: 0.75rem;
    border: 2px solid var(--red);
  }
</style>
