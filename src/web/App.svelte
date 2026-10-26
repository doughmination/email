<!-- mailbox/src/web/App.svelte
     Copyright (c) 2026 Clove Nytrix Doughmination Twilight
     Licensed under the DASL-1.0 Licence.
     See LICENCE.md in the project root for full licence information. -->
<script lang="ts">
  import Menu from "@lucide/svelte/icons/menu";
  import SquarePen from "@lucide/svelte/icons/square-pen";
  import Composer from "./components/Composer.svelte";
  import Sidebar from "./components/Sidebar.svelte";
  import ThreadList from "./components/ThreadList.svelte";
  import ThreadView from "./components/ThreadView.svelte";
  import { startLive } from "./lib/live";
  import { hideSplash } from "./lib/splash";
  import { isDemo, router } from "./lib/router.svelte";
  import { composeNew, composer, loadSession, session } from "./lib/state.svelte";
  import Admin from "./pages/Admin.svelte";
  import Privacy from "./pages/Privacy.svelte";
  import Settings from "./pages/Settings.svelte";
  import Terms from "./pages/Terms.svelte";

  const route = $derived(router.route);
  const legal = $derived(route.name === "privacy" || route.name === "terms");

  // The privacy policy and terms are public, so opening them directly doesn't
  // sign you in first. Anywhere else loads the session (and redirects to
  // sign-in if needed).
  let error = $state("");
  let started = false;
  $effect(() => {
    if (started || legal) return;
    started = true;
    loadSession()
      .then(() => !isDemo && startLive())
      .catch((e: Error) => (error = e.message));
  });
  $effect(() => {
    if (session.me || error || legal) hideSplash();
  });

  const reading = $derived(route.name === "folder" && route.threadId !== null);

  $effect(() => {
    if (router.path === "/") router.go("/inbox", { replace: true });
  });

  /** Phones: the sidebar is a drawer behind the menu button. */
  let drawer = $state(false);
  $effect(() => {
    // Any navigation closes it.
    void [router.path, router.search];
    drawer = false;
  });

  const titles: Record<string, string> = { inbox: "Inbox", sent: "Sent", drafts: "Drafts", bin: "Bin" };
  const pageTitles: Record<string, string> = { settings: "Settings", privacy: "Privacy", terms: "Terms", admin: "Admin" };
  const title = $derived(route.name === "folder" ? titles[route.folder] : pageTitles[route.name]);
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && (drawer = false)} />

{#if error}
  <p class="error boot">{error}</p>
{:else if !session.me && legal}
  {#if route.name === "privacy"}<Privacy standalone />{:else}<Terms standalone />{/if}
{:else if !session.me}
  <p class="muted boot">Loading…</p>
{:else}
  <div class="shell" class:reading>
    <!-- Phones only: a Gmail-style app bar over the list. -->
    <header class="appbar">
      <button class="menu-btn" aria-label="Menu" aria-expanded={drawer} onclick={() => (drawer = true)}><Menu size={22} /></button>
      <div class="appbar-title">
        <span>{title}</span>
        {#if router.mailbox}<span class="muted mailbox">{router.mailbox}</span>{/if}
      </div>
      <span class="avatar" title={session.me.username}>{(session.me.name || session.me.username).charAt(0).toUpperCase()}</span>
    </header>

    <Sidebar open={drawer} onclose={() => (drawer = false)} />
    {#if route.name === "folder"}
      <ThreadList folder={route.folder} selected={route.threadId} />
      {#if route.threadId}
        {#key route.threadId + route.folder}<ThreadView id={route.threadId} bin={route.folder === "bin"} />{/key}
      {:else}
        <p class="muted empty">Select a conversation to read it.</p>
      {/if}
    {:else if route.name === "settings"}
      <Settings />
    {:else if route.name === "privacy"}
      <Privacy />
    {:else if route.name === "terms"}
      <Terms />
    {:else if route.name === "admin" && session.me.isAdmin}
      <Admin />
    {/if}
  </div>

  {#if route.name === "folder" && !reading}
    <button class="fab" class:demo-offset={isDemo} onclick={composeNew}><SquarePen size={20} /> Compose</button>
  {/if}

  {#if composer.open}
    {#key composer.open}<Composer init={composer.open} />{/key}
  {/if}
{/if}

{#if isDemo}
  <p class="demo" role="status">Demo: nothing is really sent, and reloading starts over.</p>
{/if}

<style>
  /* Panels float over the wallpaper, like the site's cards. */
  .shell {
    display: grid;
    grid-template-columns: 250px 360px 1fr;
    gap: 0.75rem;
    height: 100%;
    padding: 0.75rem;
    overflow: hidden;
  }

  .shell > :global(*) {
    min-height: 0;
  }

  .empty {
    align-self: center;
    justify-self: center;
  }

  .boot {
    padding: 2rem;
  }

  .demo {
    position: fixed;
    bottom: 0.75rem;
    left: 50%;
    z-index: 20;
    max-width: calc(100% - 2rem);
    margin: 0;
    padding: 0.35rem 0.9rem;
    transform: translateX(-50%);
    border: 1px solid var(--accent-line);
    border-radius: 999px;
    background: var(--panel);
    backdrop-filter: blur(14px);
    color: var(--muted);
    font-size: 0.75rem;
    text-align: center;
    pointer-events: none;
  }

  .appbar,
  .fab {
    display: none;
  }

  /* Phones: one column at a time, like Gmail's app. An app bar and the list
     until a thread opens, then just the thread. The sidebar is a drawer. */
  @media (max-width: 800px) {
    .shell {
      grid-template-columns: 1fr;
      grid-template-rows: auto 1fr;
      padding: 0;
      gap: 0;
    }

    .shell.reading {
      grid-template-rows: 1fr;
    }

    .shell.reading > .appbar,
    .shell.reading > :global(.list),
    .shell:not(.reading) > .empty {
      display: none;
    }

    .appbar {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin: calc(0.5rem + env(safe-area-inset-top)) 0.75rem 0.5rem;
      padding: 0.3rem 0.5rem 0.3rem 0.3rem;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: var(--panel);
      backdrop-filter: blur(14px);
    }

    .menu-btn {
      display: grid;
      place-items: center;
      width: 2.5rem;
      height: 2.5rem;
      padding: 0;
      border: none;
      border-radius: 50%;
      background: none;
      color: var(--text);
      cursor: pointer;
    }

    .menu-btn:hover {
      background: var(--raised-hover);
    }

    .appbar-title {
      display: flex;
      flex: 1;
      align-items: baseline;
      gap: 0.5rem;
      min-width: 0;
      font-weight: 600;
    }

    .appbar-title span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .mailbox {
      font-size: 0.8rem;
      font-weight: 400;
    }

    .avatar {
      display: grid;
      flex-shrink: 0;
      place-items: center;
      width: 2rem;
      height: 2rem;
      border-radius: 50%;
      background: var(--accent);
      color: #fff;
      font-size: 0.9rem;
      font-weight: 700;
    }

    .fab {
      position: fixed;
      right: 1rem;
      bottom: calc(1rem + env(safe-area-inset-bottom));
      z-index: 5;
      display: inline-flex;
      align-items: center;
      gap: 0.6rem;
      padding: 1rem 1.25rem;
      border: none;
      border-radius: 1.1rem;
      background: var(--accent);
      color: #fff;
      font-weight: 600;
      box-shadow: 0 6px 20px rgb(0 0 0 / 45%);
      cursor: pointer;
    }

    .fab.demo-offset {
      bottom: calc(3rem + env(safe-area-inset-bottom));
    }

    .demo {
      bottom: calc(0.5rem + env(safe-area-inset-bottom));
    }
  }
</style>
