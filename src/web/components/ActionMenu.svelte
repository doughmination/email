<!-- mailbox/src/web/components/ActionMenu.svelte
     Copyright (c) 2026 Clove Nytrix Doughmination Twilight
     Licensed under the DASL-1.0 Licence.
     See LICENCE.md in the project root for full licence information. -->
<script lang="ts" module>
  import type { Component } from "svelte";

  export interface MenuItem {
    label: string;
    icon: Component<{ size?: number }>;
    danger?: boolean;
    // Asks for a second tap, showing this label, before running.
    confirm?: string;
    run: () => void;
  }
</script>

<script lang="ts">
  import { onMount } from "svelte";
  import { fade, fly } from "svelte/transition";
  import type { HoldPoint } from "./SwipeRow.svelte";

  let {
    title,
    items,
    at,
    onclose,
  }: {
    title: string;
    items: MenuItem[];
    at: HoldPoint;
    onclose: () => void;
  } = $props();

  let menu: HTMLDivElement;
  let menuWidth = $state(0);
  let menuHeight = $state(0);
  let confirming = $state<MenuItem | null>(null);

  // The finger that held the row lifts over the backdrop; don't close on it.
  const openedAt = performance.now();

  function onbackdrop() {
    if (performance.now() - openedAt > 350) onclose();
  }

  // Keeps the popover on screen, flipping above the cursor if need be.
  const left = $derived(Math.max(8, Math.min(at.x, innerWidth - menuWidth - 8)));
  const top = $derived(at.y + menuHeight + 8 > innerHeight ? Math.max(8, at.y - menuHeight) : at.y);

  onMount(() => {
    menu.querySelector("button")?.focus();
  });

  function choose(item: MenuItem) {
    if (item.confirm && confirming !== item) return void (confirming = item);
    onclose();
    item.run();
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === "Escape") return onclose();
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const buttons = [...menu.querySelectorAll("button")];
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    buttons[(current + step + buttons.length) % buttons.length]?.focus();
  }
</script>

<svelte:window {onkeydown} />

<div
  class="backdrop"
  class:sheet-backdrop={!at.mouse}
  role="presentation"
  onclick={onbackdrop}
  oncontextmenu={(event) => {
    event.preventDefault();
    onclose();
  }}
  transition:fade={{ duration: 120 }}
></div>

<div
  class="menu"
  class:sheet={!at.mouse}
  role="menu"
  aria-label={title}
  tabindex="-1"
  bind:this={menu}
  bind:clientWidth={menuWidth}
  bind:clientHeight={menuHeight}
  style:left={at.mouse ? `${left}px` : undefined}
  style:top={at.mouse ? `${top}px` : undefined}
  transition:fly={{
    y: at.mouse ? -6 : 40,
    duration: 160,
  }}
>
  {#if !at.mouse}
    <span class="grip" aria-hidden="true"></span>
    <p class="title">{title}</p>
  {/if}

  {#each items as item (item.label)}
    {@const Icon = item.icon}
    <button
      role="menuitem"
      class:danger={item.danger}
      onclick={() => choose(item)}
    >
      <Icon size={18} />
      {confirming === item ? item.confirm : item.label}
    </button>
  {/each}
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 30;
  }

  .sheet-backdrop {
    background: rgb(0 0 0 / 45%);
  }

  .menu {
    position: fixed;
    z-index: 31;
    display: flex;
    flex-direction: column;
    min-width: 13rem;
    padding: 0.35rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: rgb(22 19 26 / 96%);
    backdrop-filter: blur(14px);
    box-shadow: 0 10px 30px rgb(0 0 0 / 50%);
  }

  .menu:focus {
    outline: none;
  }

  .sheet {
    right: 0;
    bottom: 0;
    left: 0;
    padding: 0.5rem 0.5rem calc(0.75rem + env(safe-area-inset-bottom));
    border-width: 1px 0 0;
    border-radius: 1.25rem 1.25rem 0 0;
  }

  .grip {
    width: 2.5rem;
    height: 0.25rem;
    margin: 0.2rem auto 0.5rem;
    border-radius: 999px;
    background: var(--line);
  }

  .title {
    overflow: hidden;
    margin: 0 0.75rem 0.4rem;
    color: var(--muted);
    font-size: 0.85rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  button {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.55rem 0.75rem;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text);
    cursor: pointer;
    font-size: 0.9rem;
    text-align: left;
  }

  .sheet button {
    padding: 0.85rem 1rem;
    font-size: 1rem;
  }

  button:hover,
  button:focus-visible {
    background: var(--raised-hover);
    box-shadow: none;
  }

  button.danger {
    color: var(--danger);
  }
</style>
