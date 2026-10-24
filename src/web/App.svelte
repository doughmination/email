<!-- mailbox/src/web/App.svelte
     Copyright (c) 2026 Clove Nytrix Doughmination Twilight
     Licensed under the DASL-1.0 Licence.
     See LICENCE.md in the project root for full licence information. -->
<script lang="ts">
  import Composer from "./components/Composer.svelte";
  import Sidebar from "./components/Sidebar.svelte";
  import ThreadList from "./components/ThreadList.svelte";
  import ThreadView from "./components/ThreadView.svelte";
  import { router } from "./lib/router.svelte";
  import { composer, loadSession, session } from "./lib/state.svelte";
  import Admin from "./pages/Admin.svelte";
  import Settings from "./pages/Settings.svelte";

  let error = $state("");
  loadSession().catch((e: Error) => (error = e.message));

  const route = $derived(router.route);
  const reading = $derived(route.name === "folder" && route.threadId !== null);

  $effect(() => {
    if (location.pathname === "/") router.go("/inbox", { replace: true });
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
        {#key route.threadId}<ThreadView id={route.threadId} />{/key}
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
