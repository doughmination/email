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
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import type { ListFolder } from "../../shared/types";
  import { api } from "../lib/api";
  import { router } from "../lib/router.svelte";
  import { composeNew, session } from "../lib/state.svelte";

  const folders: { folder: ListFolder; label: string; icon: typeof InboxIcon }[] = [
    { folder: "inbox", label: "Inbox", icon: InboxIcon },
    { folder: "sent", label: "Sent", icon: Send },
    { folder: "drafts", label: "Drafts", icon: FileText },
    { folder: "bin", label: "Bin", icon: Trash2 },
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

  function folderHref(folder: ListFolder, mailbox: string | null = router.mailbox) {
    return `/${folder}${mailbox ? `?in=${encodeURIComponent(mailbox)}` : ""}`;
  }

  async function logout() {
    const { endSession } = await api.logout();
    location.href = endSession ?? "/";
  }
</script>

<nav class="sidebar">
  <button class="btn accent compose" onclick={composeNew}><SquarePen size={16} /> New message</button>

  <ul class="folders">
    {#each folders as f (f.folder)}
      <li>
        <a class="item" class:active={current === f.folder} href={router.href(folderHref(f.folder))}>
          <f.icon size={16} />
          <span>{f.label}</span>
          {#if f.folder === "inbox" && total}<span class="count">{total}</span>{/if}
        </a>
      </li>
    {/each}
  </ul>

  {#if byDomain.length > 1 || (byDomain[0]?.[1].length ?? 0) > 1}
    <h3 class="mailboxes-title">Mailboxes</h3>
    <ul class="mailboxes">
      <li>
        <a class="item" class:active={!router.mailbox} href={router.href(folderHref(current ?? "inbox", null))}>
          <span>All</span>
        </a>
      </li>
      {#each byDomain as [domain, addresses] (domain)}
        <li>
          <a class="item domain" class:active={router.mailbox === `@${domain}`} href={router.href(folderHref(current ?? "inbox", `@${domain}`))}>
            <Globe size={14} />
            <span>{domain}</span>
            {#if unreadFor(domain)}<span class="count">{unreadFor(domain)}</span>{/if}
          </a>
          <ul>
            {#each addresses as addr (addr)}
              <li>
                <a class="item address" class:active={router.mailbox === addr} href={router.href(folderHref(current ?? "inbox", addr))}>
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

  {#if byDomain.length > 1 || (byDomain[0]?.[1].length ?? 0) > 1}
    <!-- Phones get the mailbox tree as a dropdown. -->
    <select
      class="input mailbox-picker"
      aria-label="Mailbox"
      value={router.mailbox ?? ""}
      onchange={(e) => router.go(folderHref(current ?? "inbox", e.currentTarget.value || null))}
    >
      <option value="">All mailboxes</option>
      {#each byDomain as [domain, addresses] (domain)}
        <option value="@{domain}">{domain}</option>
        {#each addresses as addr (addr)}<option value={addr}>&nbsp;&nbsp;{addr}</option>{/each}
      {/each}
    </select>
  {/if}

  <ul class="bottom">
    <li><a class="item" class:active={route.name === "settings"} href={router.href("/settings")}><SettingsIcon size={16} /> <span class="label">Settings</span></a></li>
    {#if session.me?.isAdmin}
      <li><a class="item" class:active={route.name === "admin"} href={router.href("/admin")}><Shield size={16} /> <span class="label">Admin</span></a></li>
    {/if}
    <li><button class="item" onclick={logout}><LogOut size={16} /> <span class="label">Log out</span></button></li>
  </ul>
</nav>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 1rem 0.75rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--panel);
    backdrop-filter: blur(14px);
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
    padding-left: 1.1rem;
  }

  h3 {
    margin: 0.9rem 0 0.25rem 0.75rem;
    color: var(--accent);
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .item {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    width: 100%;
    padding: 0.45rem 0.75rem;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--muted);
    font-size: 0.9rem;
    text-align: left;
    text-decoration: none;
    cursor: pointer;
    transition:
      background 0.15s ease,
      border-color 0.15s ease,
      color 0.15s ease;
  }

  .item span:not(.count) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .item:hover {
    background: var(--raised-hover);
    color: var(--text);
  }

  .item.active {
    border-color: var(--accent-line);
    background: var(--accent-dim);
    color: var(--text);
    font-weight: 600;
  }

  .count {
    margin-left: auto;
    padding: 0 0.45rem;
    border-radius: 999px;
    background: var(--accent);
    color: #fff;
    font-size: 0.7rem;
    font-weight: 700;
  }

  .bottom {
    margin-top: auto;
  }
  .mailbox-picker {
    display: none;
  }

  /* Phones: one scrollable row of folders, with mailboxes as a dropdown. */
  @media (max-width: 800px) {
    .sidebar {
      flex-direction: row;
      align-items: center;
      gap: 0.25rem;
      padding: 0.5rem;
      overflow-x: auto;
      overflow-y: hidden;
    }

    .compose {
      flex-shrink: 0;
      margin: 0;
    }

    .folders,
    .bottom {
      display: flex;
      flex-shrink: 0;
      margin: 0;
    }

    .mailboxes-title,
    .mailboxes,
    .bottom .label {
      display: none;
    }

    .mailbox-picker {
      display: block;
      flex-shrink: 0;
      max-width: 11rem;
      padding-block: 0.35rem;
      font-size: 0.85rem;
    }

    .item {
      width: auto;
      white-space: nowrap;
    }
  }
</style>
