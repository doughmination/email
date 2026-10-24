<!-- mailbox/src/web/components/Sidebar.svelte
     Copyright (c) 2026 Clove Nytrix Doughmination Twilight
     Licensed under the DASL-1.0 Licence.
     See LICENCE.md in the project root for full licence information. -->
<script lang="ts">
  import FileText from "@lucide/svelte/icons/file-text";
  import Globe from "@lucide/svelte/icons/globe";
  import InboxIcon from "@lucide/svelte/icons/inbox";
  import LogOut from "@lucide/svelte/icons/log-out";
  import Send from "@lucide/svelte/icons/send";
  import SettingsIcon from "@lucide/svelte/icons/settings";
  import Shield from "@lucide/svelte/icons/shield";
  import SquarePen from "@lucide/svelte/icons/square-pen";
  import type { Folder } from "../../shared/types";
  import { api } from "../lib/api";
  import { router } from "../lib/router.svelte";
  import { composeNew, session } from "../lib/state.svelte";

  const folders: { folder: Folder; label: string; icon: typeof InboxIcon }[] = [
    { folder: "inbox", label: "Inbox", icon: InboxIcon },
    { folder: "sent", label: "Sent", icon: Send },
    { folder: "drafts", label: "Drafts", icon: FileText },
  ];

  const route = $derived(router.route);
  const current = $derived(route.name === "folder" ? route.folder : null);

  /** The user's addresses grouped under their domain. */
  const byDomain = $derived.by(() => {
    const groups = new Map<string, string[]>();
    for (const addr of session.me?.addresses ?? []) {
      const domain = addr.slice(addr.lastIndexOf("@") + 1);
      groups.set(domain, [...(groups.get(domain) ?? []), addr]);
    }
    return [...groups].sort(([a], [b]) => a.localeCompare(b));
  });

  const total = $derived(Object.values(session.unread).reduce((n, c) => n + c, 0));
  const unreadFor = (domain: string) =>
    Object.entries(session.unread)
      .filter(([addr]) => addr.endsWith(`@${domain}`))
      .reduce((n, [, c]) => n + c, 0);

  function folderHref(folder: Folder, mailbox: string | null = router.mailbox) {
    return `/${folder}${mailbox ? `?in=${encodeURIComponent(mailbox)}` : ""}`;
  }

  async function logout() {
    const { endSession } = await api.logout();
    location.href = endSession ?? "/";
  }
</script>

<nav class="sidebar">
  <button class="btn accent compose" onclick={composeNew}><SquarePen size={16} /> New message</button>

  <ul>
    {#each folders as f (f.folder)}
      <li>
        <a class="item" class:active={current === f.folder} href={folderHref(f.folder)}>
          <f.icon size={16} />
          <span>{f.label}</span>
          {#if f.folder === "inbox" && total}<span class="count">{total}</span>{/if}
        </a>
      </li>
    {/each}
  </ul>

  {#if byDomain.length > 1 || (byDomain[0]?.[1].length ?? 0) > 1}
    <h3>Mailboxes</h3>
    <ul>
      <li>
        <a class="item" class:active={!router.mailbox} href={folderHref(current ?? "inbox", null)}>
          <span>All</span>
        </a>
      </li>
      {#each byDomain as [domain, addresses] (domain)}
        <li>
          <a class="item domain" class:active={router.mailbox === `@${domain}`} href={folderHref(current ?? "inbox", `@${domain}`)}>
            <Globe size={14} />
            <span>{domain}</span>
            {#if unreadFor(domain)}<span class="count">{unreadFor(domain)}</span>{/if}
          </a>
          <ul>
            {#each addresses as addr (addr)}
              <li>
                <a class="item address" class:active={router.mailbox === addr} href={folderHref(current ?? "inbox", addr)}>
                  <span>{addr.slice(0, addr.lastIndexOf("@"))}</span>
                  {#if session.unread[addr]}<span class="count">{session.unread[addr]}</span>{/if}
                </a>
              </li>
            {/each}
          </ul>
        </li>
      {/each}
    </ul>
  {/if}

  <ul class="bottom">
    <li><a class="item" class:active={route.name === "settings"} href="/settings"><SettingsIcon size={16} /> Settings</a></li>
    {#if session.me?.isAdmin}
      <li><a class="item" class:active={route.name === "admin"} href="/admin"><Shield size={16} /> Admin</a></li>
    {/if}
    <li><button class="item" onclick={logout}><LogOut size={16} /> Log out</button></li>
  </ul>
</nav>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.85rem 0.6rem;
    background: var(--crust);
    border-right: 2px solid var(--surface1);
    overflow-y: auto;
  }

  .compose {
    justify-content: center;
    margin-bottom: 0.5rem;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  ul ul {
    padding-left: 1.4rem;
  }

  h3 {
    margin: 0.75rem 0 0.25rem 0.75rem;
    font-size: 0.7rem;
    color: var(--overlay0);
  }

  .item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.45rem 0.75rem;
    border: 1px solid transparent;
    background: transparent;
    color: var(--subtext1);
    text-decoration: none;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 0.8rem;
    cursor: pointer;
    transition: background 0.12s ease, transform 0.12s ease;
  }

  .item.address {
    text-transform: none;
    letter-spacing: normal;
  }

  .item.domain {
    text-transform: none;
  }

  .item span:not(.count) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .item:hover {
    background: var(--surface0);
    transform: translateX(2px);
  }

  .item.active {
    background: var(--surface0);
    color: var(--text);
    font-weight: 700;
    border-color: var(--pink);
    border-left-width: 3px;
  }

  .count {
    margin-left: auto;
    padding: 0 0.4rem;
    background: var(--pink);
    color: var(--crust);
    font-size: 0.7rem;
    font-weight: 700;
  }

  .bottom {
    margin-top: auto;
  }
</style>
