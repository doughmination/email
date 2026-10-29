<!-- mailbox/src/web/components/Sidebar.svelte
     Copyright (c) 2026 Clove Nytrix Doughmination Twilight
     Licensed under the DASL-1.0 Licence.
     See LICENCE.md in the project root for full licence information. -->
<script lang="ts">
  import FileText from "../lib/icons/FileText.svelte";
  import Globe from "../lib/icons/Globe.svelte";
  import InboxIcon from "../lib/icons/Inbox.svelte";
  import LogOut from "../lib/icons/LogOut.svelte";
  import Send from "../lib/icons/Send.svelte";
  import SettingsIcon from "../lib/icons/Settings.svelte";
  import Shield from "../lib/icons/Shield.svelte";
  import SquarePen from "../lib/icons/SquarePen.svelte";
  import Star from "../lib/icons/Star.svelte";
  import Trash2 from "../lib/icons/Trash2.svelte";
  import type { ListFolder } from "../../shared/types";
  import { api } from "../lib/api";
  import { router } from "../lib/router.svelte";
  import { composeNew, session } from "../lib/state.svelte";

  /** Phones: whether the drawer is out. Ignored on wider screens. */
  let { open = false, onclose = () => {} }: { open?: boolean; onclose?: () => void } = $props();

  const folders: { folder: ListFolder; label: string; icon: typeof InboxIcon }[] = [
    { folder: "inbox", label: "Inbox", icon: InboxIcon },
    { folder: "starred", label: "Starred", icon: Star },
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

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" class:open onclick={onclose}></div>

<nav class="sidebar" class:open>
  <p class="brand eyebrow">Mail</p>
  <button class="btn accent compose" onclick={() => (onclose(), composeNew())}><SquarePen size={16} /> New message</button>

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
        <a class="item" class:active={current && !router.mailbox} href={router.href(folderHref(current ?? "inbox", null))}>
          <span>All</span>
        </a>
      </li>
      {#each byDomain as [domain, addresses] (domain)}
        <li>
          <a class="item domain" class:active={current && router.mailbox === `@${domain}`} href={router.href(folderHref(current ?? "inbox", `@${domain}`))}>
            <Globe size={14} />
            <span>{domain}</span>
            {#if unreadFor(domain)}<span class="count">{unreadFor(domain)}</span>{/if}
          </a>
          <ul>
            {#each addresses as addr (addr)}
              <li>
                <a class="item address" class:active={current && router.mailbox === addr} href={router.href(folderHref(current ?? "inbox", addr))}>
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
    <li><a class="item" class:active={route.name === "settings" || route.name === "privacy" || route.name === "terms"} href={router.href("/settings")}><SettingsIcon size={16} /> <span class="label">Settings</span></a></li>
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
  .brand,
  .scrim {
    display: none;
  }

  /* Phones: a drawer that slides in from the left, as in Gmail. The compose
     button lives on the list as a floating button instead. */
  @media (max-width: 800px) {
    .sidebar {
      position: fixed;
      inset: 0 auto 0 0;
      z-index: 30;
      width: min(80vw, 300px);
      padding: calc(1rem + env(safe-area-inset-top)) 0.75rem calc(1rem + env(safe-area-inset-bottom));
      border-width: 0 1px 0 0;
      border-radius: 0 var(--radius) var(--radius) 0;
      background: #131116;
      transform: translateX(-105%);
      visibility: hidden;
      transition:
        transform 0.2s ease,
        visibility 0s linear 0.2s;
    }

    .sidebar.open {
      transform: none;
      visibility: visible;
      transition: transform 0.2s ease;
    }

    .scrim {
      position: fixed;
      inset: 0;
      z-index: 29;
      display: block;
      background: rgb(0 0 0 / 55%);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s ease;
    }

    .scrim.open {
      opacity: 1;
      pointer-events: auto;
    }

    .brand {
      display: block;
      margin: 0 0 0.25rem 0.75rem;
    }

    .compose {
      display: none;
    }

    .item {
      padding-block: 0.6rem;
    }
  }
</style>
