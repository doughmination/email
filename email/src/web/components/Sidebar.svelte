<!-- mailbox/src/web/components/Sidebar.svelte
     Copyright (c) 2026 Clove Nytrix Doughmination Twilight
     Licensed under the DASL-1.0 Licence.
     See LICENCE.md in the project root for full licence information. -->
<script lang="ts">
  import AllInbox from "../lib/icons/AllInbox.svelte";
  import AlternateEmail from "../lib/icons/AlternateEmail.svelte";
  import FileText from "../lib/icons/FileText.svelte";
  import Globe from "../lib/icons/Globe.svelte";
  import InboxIcon from "../lib/icons/Inbox.svelte";
  import LogOut from "../lib/icons/LogOut.svelte";
  import Mail from "../lib/icons/Mail.svelte";
  import Mobile from "../lib/icons/Mobile.svelte";
  import Send from "../lib/icons/Send.svelte";
  import SettingsIcon from "../lib/icons/Settings.svelte";
  import Shield from "../lib/icons/Shield.svelte";
  import SquarePen from "../lib/icons/SquarePen.svelte";
  import StarOff from "../lib/icons/StarOff.svelte";
  import Trash2 from "../lib/icons/Trash2.svelte";
  import type { ListFolder } from "../../shared/types";
  import { api } from "../lib/api";
  import { router } from "../lib/router.svelte";
  import { composeNew, session } from "../lib/state.svelte";

  /** Phones: whether the drawer is out. Ignored on wider screens. */
  let { open = false, onclose = () => {} }: { open?: boolean; onclose?: () => void } = $props();

  const folders: { folder: ListFolder; label: string; icon: typeof InboxIcon }[] = [
    { folder: "inbox", label: "Inbox", icon: InboxIcon },
    { folder: "starred", label: "Starred", icon: StarOff },
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

<!-- The Android app's drawer: who you are, the folders, your mailboxes, then
     settings. On wide screens it's the sidebar, with a compose button. -->
<nav class="sidebar" class:open>
  <div class="who">
    <Mail size={24} />
    <div>
      <p class="name">{session.me?.name || session.me?.username || "Inbox"}</p>
      {#if session.me?.addresses[0]}<p class="address">{session.me.addresses[0]}</p>{/if}
    </div>
  </div>
  <button class="btn accent compose" onclick={() => (onclose(), composeNew())}><SquarePen size={18} /> New message</button>
  <hr />

  <ul>
    {#each folders as f (f.folder)}
      <li>
        <a class="item" class:active={current === f.folder} href={router.href(folderHref(f.folder))}>
          <f.icon size={24} />
          <span class="label">{f.label}</span>
          {#if f.folder === "inbox" && total}<span class="count">{total}</span>{/if}
        </a>
      </li>
    {/each}
  </ul>

  {#if (session.me?.addresses.length ?? 0) > 1}
    <hr />
    <ul>
      <li>
        <a class="item" class:active={current && !router.mailbox} href={router.href(folderHref(current ?? "inbox", null))}>
          <AllInbox size={24} />
          <span class="label">All addresses</span>
        </a>
      </li>
      {#each byDomain as [domain, addresses] (domain)}
        <li>
          <a class="item" class:active={current && router.mailbox === `@${domain}`} href={router.href(folderHref(current ?? "inbox", `@${domain}`))}>
            <Globe size={24} />
            <span class="label">{domain}</span>
            {#if unreadFor(domain)}<span class="count">{unreadFor(domain)}</span>{/if}
          </a>
        </li>
        {#if addresses.length > 1}
          {#each addresses as addr (addr)}
            <li>
              <a class="item indent" class:active={current && router.mailbox === addr} href={router.href(folderHref(current ?? "inbox", addr))}>
                <AlternateEmail size={24} />
                <span class="label">{addr.slice(0, addr.lastIndexOf("@"))}</span>
                {#if session.unread[addr]}<span class="count">{session.unread[addr]}</span>{/if}
              </a>
            </li>
          {/each}
        {/if}
      {/each}
    </ul>
  {/if}

  <hr />
  <ul class="bottom">
    <li><a class="item" class:active={route.name === "settings" || route.name === "privacy" || route.name === "terms"} href={router.href("/settings")}><SettingsIcon size={24} /> <span class="label">Settings</span></a></li>
    {#if session.me?.isAdmin}
      <li><a class="item" class:active={route.name === "admin"} href={router.href("/admin")}><Shield size={24} /> <span class="label">Admin</span></a></li>
    {/if}
    <!-- `download` keeps the router from treating it as a page in the app. -->
    <li><a class="item" href="/download" download><Mobile size={24} /> <span class="label">Get the Android app</span></a></li>
    <li><button class="item" onclick={logout}><LogOut size={24} /> <span class="label">Log out</span></button></li>
  </ul>
</nav>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    padding: 0.75rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--panel);
    backdrop-filter: blur(14px);
    overflow-y: auto;
  }

  .who {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    color: var(--accent);
  }

  .who p {
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .who > div {
    min-width: 0;
  }

  .name {
    color: var(--text);
    font-size: 1rem;
    font-weight: 500;
    line-height: 1.5;
  }

  .address {
    color: var(--muted);
    font-size: 0.75rem;
    font-weight: 500;
  }

  .compose {
    margin: 0.25rem 0.5rem 0.5rem;
  }

  hr {
    width: 100%;
    margin: 0.5rem 0;
    border: none;
    border-top: 1px solid var(--outline-variant);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  /* Material's navigation drawer item: a full-width pill, filled when it's
     where you are. */
  .item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    min-height: 3rem;
    padding: 0 1.5rem 0 1rem;
    border: none;
    border-radius: 999px;
    background: transparent;
    color: var(--muted);
    font-size: 0.875rem;
    font-weight: 500;
    text-align: left;
    text-decoration: none;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .item.indent {
    padding-left: 2.5rem;
  }

  .label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .item:hover {
    background: rgb(255 255 255 / 8%);
    color: var(--muted);
  }

  .item.active {
    background: var(--secondary-container);
    color: var(--on-secondary-container);
  }

  /* Material's badge, in the theme's error colour as the app's are. */
  .count {
    min-width: 1rem;
    padding: 0 0.25rem;
    border-radius: 999px;
    background: var(--danger);
    color: #690005;
    font-size: 0.6875rem;
    font-weight: 500;
    line-height: 1rem;
    text-align: center;
  }

  .bottom {
    margin-top: auto;
  }

  .scrim {
    display: none;
  }

  /* Phones: a drawer that slides in from the left, as in the app. The compose
     button lives on the list as a floating button instead. */
  @media (max-width: 800px) {
    .sidebar {
      position: fixed;
      inset: 0 auto 0 0;
      z-index: 30;
      width: min(85vw, 360px);
      padding: calc(0.75rem + env(safe-area-inset-top)) 0.75rem calc(0.75rem + env(safe-area-inset-bottom));
      border: none;
      border-radius: 0 var(--radius) var(--radius) 0;
      background: var(--surface-low);
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

    .compose {
      display: none;
    }

    .item {
      min-height: 3.5rem;
    }

    .bottom {
      margin-top: 0;
    }
  }
</style>
