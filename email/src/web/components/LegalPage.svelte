<!-- mailbox/src/web/components/LegalPage.svelte
     Copyright (c) 2026 Clove Nytrix Doughmination Twilight
     Licensed under the DASL-1.0 Licence.
     See LICENCE.md in the project root for full licence information. -->
<script lang="ts">
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import type { Snippet } from "svelte";
  import { router } from "../lib/router.svelte";

  /**
   * The privacy policy and terms. `standalone` is for visitors who aren't
   * signed in (app stores need a public link): no app shell around it.
   */
  let { title, updated, standalone = false, children }: { title: string; updated: string; standalone?: boolean; children: Snippet } =
    $props();
</script>

<div class="page" class:standalone>
  {#if standalone}
    <a class="back" href={router.href("/inbox")}><ArrowLeft size={16} /> Go to the inbox</a>
  {:else}
    <a class="back" href={router.href("/settings")}><ArrowLeft size={16} /> Settings</a>
  {/if}
  <h1>{title}</h1>
  <p class="muted updated">Last updated {updated}</p>
  {@render children()}
</div>

<style>
  .page {
    grid-column: 2 / -1;
    overflow-y: auto;
    padding: 0.5rem 0.25rem;
  }

  .page.standalone {
    position: relative;
    height: 100%;
    padding: 1.5rem max(1rem, calc(50% - 320px));
  }

  .back {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    margin-top: 0.5rem;
    color: var(--muted);
    font-size: 0.85rem;
    text-decoration: none;
  }

  .back:hover {
    color: var(--text);
  }

  h1 {
    margin: 0.5rem 0 0.25rem;
    font-size: clamp(1.75rem, 4vw, 2.5rem);
    font-weight: 700;
    letter-spacing: -0.03em;
  }

  .updated {
    margin: 0 0 1.25rem;
    font-size: 0.85rem;
  }

  .page :global(section) {
    max-width: 640px;
    margin-bottom: 1rem;
    padding: 1.25rem 1.5rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--panel);
    backdrop-filter: blur(14px);
    line-height: 1.55;
  }

  .page :global(section p) {
    margin: 0.5rem 0 0;
  }

  .page :global(h2) {
    margin: 0 0 0.5rem;
    color: var(--accent);
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .page :global(ul) {
    margin: 0.5rem 0 0;
    padding-left: 1.1rem;
  }

  .page :global(li + li) {
    margin-top: 0.35rem;
  }

  .page :global(section a) {
    color: var(--accent);
  }

  /* Phones: the app bar names the page; cards run edge to edge of the gutter. */
  @media (max-width: 800px) {
    .page {
      grid-column: 1 / -1;
      padding: 0 0.75rem 2rem;
    }

    .page.standalone {
      padding: calc(1rem + env(safe-area-inset-top)) 1rem calc(2rem + env(safe-area-inset-bottom));
    }

    .page:not(.standalone) h1 {
      display: none;
    }

    .page :global(section) {
      padding: 1rem;
    }
  }
</style>
