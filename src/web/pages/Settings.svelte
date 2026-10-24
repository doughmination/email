<!-- mailbox/src/web/pages/Settings.svelte
     Copyright (c) 2026 Clove Nytrix Doughmination Twilight
     Licensed under the DASL-1.0 Licence.
     See LICENCE.md in the project root for full licence information. -->
<script lang="ts">
  import Bell from "@lucide/svelte/icons/bell";
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { session } from "../lib/state.svelte";

  let subscription = $state<PushSubscription | null>(null);
  let status = $state("");
  const supported = "serviceWorker" in navigator && "PushManager" in window;
  const key = $derived(session.me?.pushPublicKey ?? null);

  function keyBytes(b64: string): Uint8Array<ArrayBuffer> {
    const padded = (b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  }

  onMount(async () => {
    if (!supported) return;
    const reg = await navigator.serviceWorker.register("/sw.js");
    subscription = await reg.pushManager.getSubscription();
  });

  async function enable() {
    status = "";
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key!) });
      await api.pushSubscribe(sub.toJSON());
      subscription = sub;
    } catch (e) {
      status = (e as Error).message;
    }
  }

  async function disable() {
    if (!subscription) return;
    await api.pushUnsubscribe(subscription.endpoint);
    await subscription.unsubscribe();
    subscription = null;
  }

  async function test() {
    const { sent } = await api.pushTest();
    status = sent ? "Sent. It should arrive in a moment." : "Nothing was sent; try turning notifications off and on.";
  }
</script>

<div class="page">
  <h1>Settings</h1>

  <section>
    <h2>Your addresses</h2>
    <p class="muted">You receive and can send from each of these.</p>
    <ul>
      {#each session.me?.addresses ?? [] as a (a)}<li>{a}</li>{/each}
    </ul>
  </section>

  <section>
    <h2><Bell size={16} /> Notifications</h2>
    {#if !supported}
      <p class="muted">This browser can't do push notifications. On iOS, add the inbox to your home screen first.</p>
    {:else if !key}
      <p class="muted">Push isn't configured on the server.</p>
    {:else if subscription}
      <p>On for this device.</p>
      <button class="btn" onclick={test}>Send a test</button>
      <button class="btn danger" onclick={disable}>Turn off</button>
    {:else}
      <button class="btn accent" onclick={enable}>Turn on for this device</button>
    {/if}
    {#if status}<p class="muted">{status}</p>{/if}
  </section>
</div>

<style>
  .page {
    grid-column: 2 / -1;
    padding: 1.5rem;
    overflow-y: auto;
  }

  section {
    margin-bottom: 1.5rem;
    padding: 1rem;
    max-width: 640px;
    background: var(--mantle);
    border: 2px solid var(--surface1);
    box-shadow: var(--shadow-hard);
  }

  h1 {
    font-size: 1.1rem;
  }

  h2 {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0;
    font-size: 0.9rem;
  }
</style>
