<!-- mailbox/src/web/components/AccountPicture.svelte
     Copyright (c) 2026 Clove Nytrix Doughmination Twilight
     Licensed under the DASL-1.0 Licence.
     See LICENCE.md in the project root for full licence information. -->
<script lang="ts">
  import { session } from "../lib/state.svelte";

  /**
   * The signed-in account's picture: the SSO's, when there is one and Settings
   * says to use it, or the default, their initial on the accent colour. Also
   * falls back to the default if the SSO's picture fails to load.
   */
  let { size = 40 }: { size?: number } = $props();

  let broken = $state(false);
  const me = $derived(session.me);
  const picture = $derived(me?.usePicture && me.picture && !broken ? me.picture : null);
  const initial = $derived((me?.name || me?.username || "?").match(/\p{L}|\p{N}/u)?.[0]?.toUpperCase() ?? "?");

  // A new picture gets a fresh try.
  $effect(() => {
    void me?.picture;
    broken = false;
  });
</script>

{#if picture}
  <img class="pfp" src={picture} alt="" width={size} height={size} referrerpolicy="no-referrer" onerror={() => (broken = true)} />
{:else}
  <span class="pfp initial" style:width="{size}px" style:height="{size}px" style:font-size="{size * 0.42}px" aria-hidden="true">{initial}</span>
{/if}

<style>
  .pfp {
    flex-shrink: 0;
    border-radius: 50%;
    object-fit: cover;
  }

  .initial {
    display: grid;
    place-items: center;
    background: var(--accent);
    color: #fff;
    font-weight: 600;
  }
</style>
