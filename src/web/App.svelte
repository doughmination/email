<!-- mailbox/src/web/App.svelte
     Copyright (c) 2026 Clove Nytrix Doughmination Twilight
     Licensed under the DASL-1.0 Licence.
     See LICENCE.md in the project root for full licence information. -->
<script lang="ts">
  import Composer from "./components/Composer.svelte";
  import Sidebar from "./components/Sidebar.svelte";
  import ThreadList from "./components/ThreadList.svelte";
  import ThreadView from "./components/ThreadView.svelte";
  import { isDemo, router } from "./lib/router.svelte";
  import { composer, loadSession, session } from "./lib/state.svelte";
  import Admin from "./pages/Admin.svelte";
  import Settings from "./pages/Settings.svelte";

  let error = $state("");
  loadSession().catch((e: Error) => (error = e.message));

  const route = $derived(router.route);
  const reading = $derived(route.name === "folder" && route.threadId !== null);

  $effect(() => {
    if (router.path === "/") router.go("/inbox", { replace: true });
  });
</script>

{#if error}
  <p class="error boot">{error}</p>
{:else if !session.me}
  <p class="muted boot">Loading…</p>
{:else}
  <div class="shell" class:reading>
    <Sidebar />
    {#if route.name === "folder"}
      <ThreadList folder={route.folder} selected={route.threadId} />
      {#if route.threadId}
        {#key route.threadId + route.folder}<ThreadView id={route.threadId} bin={route.folder === "bin"} />{/key}
      {:else}
        <p class="muted empty">Select a conversation to read it.</p>
      {/if}
    {:else if route.name === "settings"}
      <Settings />
    {:else if route.name === "admin" && session.me.isAdmin}
      <Admin />
    {/if}
  </div>

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

  /* Phones: one column at a time. The list shows until a thread opens. */
  @media (max-width: 800px) {
    .shell {
      grid-template-columns: 1fr;
      grid-template-rows: auto 1fr;
      padding: 0.5rem;
      gap: 0.5rem;
    }

    .shell.reading > :global(.sidebar),
    .shell.reading > :global(.list),
    .shell:not(.reading) > .empty {
      display: none;
    }
  }
</style>
