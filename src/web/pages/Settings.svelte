<!-- mailbox/src/web/pages/Settings.svelte
     Copyright (c) 2026 Clove Nytrix Doughmination Twilight
     Licensed under the DASL-1.0 Licence.
     See LICENCE.md in the project root for full licence information. -->
<script lang="ts">
  import Bell from "../lib/icons/Bell.svelte";
  import ChevronRight from "../lib/icons/ChevronRight.svelte";
  import ShieldCheck from "../lib/icons/ShieldCheck.svelte";
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { router } from "../lib/router.svelte";
  import { session } from "../lib/state.svelte";
  import AccountPicture from "../components/AccountPicture.svelte";
  import type { Preferences, SwipeAction } from "../../shared/types";

  let name = $state(session.me?.name ?? "");
  let prefsStatus = $state("");

  const swipeLabels: Record<SwipeAction, string> = {
    none: "Nothing",
    read: "Mark as read or unread",
    star: "Star or unstar",
    bin: "Move to Bin",
  };

  /** Shows the change straight away, and puts it back if the server says no. */
  async function savePreferences(changes: Partial<Preferences>) {
    const me = session.me;
    if (!me) return;
    const before: Preferences = { usePicture: me.usePicture, swipeLeft: me.swipeLeft, swipeRight: me.swipeRight };
    Object.assign(me, changes);
    prefsStatus = "";
    try {
      Object.assign(me, await api.setPreferences(changes));
    } catch (err) {
      Object.assign(me, before);
      prefsStatus = (err as Error).message;
    }
  }
  let nameStatus = $state("");
  let subscription = $state<PushSubscription | null>(null);
  let status = $state("");
  const supported = "serviceWorker" in navigator && "PushManager" in window;
  const key = $derived(session.me?.pushPublicKey ?? null);

  function keyBytes(b64: string): Uint8Array<ArrayBuffer> {
    const padded = (b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  }

  async function saveName(e: SubmitEvent) {
    e.preventDefault();
    nameStatus = "";
    try {
      const saved = await api.setName(name);
      if (session.me) session.me.name = saved.name;
      name = saved.name ?? "";
      nameStatus = "Saved.";
    } catch (err) {
      nameStatus = (err as Error).message;
    }
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
    <h2>Your name</h2>
    <p class="muted">People see this as the sender of mail you send. Leave it empty to send from just the address.</p>
    <form class="name" onsubmit={saveName}>
      <input class="input" bind:value={name} maxlength="100" placeholder="Your name" aria-label="Your name" />
      <button class="btn accent" disabled={name.trim() === (session.me?.name ?? "")}>Save</button>
    </form>
    {#if nameStatus}<p class="muted">{nameStatus}</p>{/if}
  </section>

  <section>
    <h2>Profile picture</h2>
    <label class="pfp">
      <AccountPicture size={56} />
      <span class="grow">
        <span>Use your account's picture</span>
        <span class="muted small">
          {session.me?.picture
            ? "The one on your Doughmination account. Off shows your initial instead."
            : "Your Doughmination account has no picture, so your initial shows."}
        </span>
      </span>
      <input
        type="checkbox"
        role="switch"
        class="switch"
        checked={!!session.me?.usePicture && !!session.me?.picture}
        disabled={!session.me?.picture}
        onchange={(e) => savePreferences({ usePicture: e.currentTarget.checked })}
      />
    </label>
  </section>

  <section>
    <h2>Swipe actions</h2>
    <p class="muted">What swiping a conversation in the list does, here and in the app. Read and unread only applies to received mail, and in the Bin a swipe right always restores.</p>
    <div class="swipes">
      <label class="field">
        Swipe right
        <select value={session.me?.swipeRight} onchange={(e) => savePreferences({ swipeRight: e.currentTarget.value as SwipeAction })}>
          {#each Object.entries(swipeLabels) as [value, label] (value)}<option {value}>{label}</option>{/each}
        </select>
      </label>
      <label class="field">
        Swipe left
        <select value={session.me?.swipeLeft} onchange={(e) => savePreferences({ swipeLeft: e.currentTarget.value as SwipeAction })}>
          {#each Object.entries(swipeLabels) as [value, label] (value)}<option {value}>{label}</option>{/each}
        </select>
      </label>
    </div>
    {#if prefsStatus}<p class="error">{prefsStatus}</p>{/if}
  </section>

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
      <div class="buttons">
        <button class="btn" onclick={test}>Send a test</button>
        <button class="btn danger" onclick={disable}>Turn off</button>
      </div>
    {:else}
      <button class="btn accent" onclick={enable}>Turn on for this device</button>
    {/if}
    {#if status}<p class="muted">{status}</p>{/if}
  </section>

  <section>
    <h2><ShieldCheck size={16} /> Privacy and terms</h2>
    <p class="muted">What's stored about you and your mail, who can see it, and the rules for using the inbox.</p>
    <div class="buttons">
      <a class="btn link" href={router.href("/privacy")}>Privacy policy <ChevronRight size={16} /></a>
      <a class="btn link" href={router.href("/terms")}>Terms of service <ChevronRight size={16} /></a>
    </div>
  </section>
</div>

<style>
  .page {
    grid-column: 2 / -1;
    overflow-y: auto;
    padding: 0.5rem 0.25rem;
  }

  h1 {
    margin: 0.5rem 0 1.25rem;
    font-size: clamp(1.75rem, 4vw, 2.5rem);
    font-weight: 700;
    letter-spacing: -0.03em;
  }

  section {
    max-width: 640px;
    margin-bottom: 1rem;
    padding: 1.25rem 1.5rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--panel);
    backdrop-filter: blur(14px);
  }

  h2 {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0 0 0.5rem;
    color: var(--accent);
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  ul {
    padding-left: 1.1rem;
  }

  .name {
    display: flex;
    gap: 0.5rem;
  }

  .name input {
    flex: 1;
    min-width: 0;
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  ul li {
    overflow-wrap: anywhere;
  }

  .pfp {
    display: flex;
    align-items: center;
    gap: 1rem;
    cursor: pointer;
  }

  .grow {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }

  .small {
    font-size: 0.85rem;
  }

  .swipes {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
    gap: 0.75rem;
  }

  .swipes option {
    background: var(--surface-high);
  }

  /* Material's switch. */
  .switch {
    position: relative;
    flex-shrink: 0;
    width: 52px;
    height: 32px;
    margin: 0;
    border: 2px solid var(--outline);
    border-radius: 999px;
    background: var(--surface-high);
    appearance: none;
    cursor: pointer;
    transition:
      background 0.15s ease,
      border-color 0.15s ease;
  }

  .switch::before {
    content: "";
    position: absolute;
    top: 50%;
    left: 6px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--outline);
    transform: translateY(-50%);
    transition:
      left 0.15s ease,
      width 0.15s ease,
      height 0.15s ease,
      background 0.15s ease;
  }

  .switch:checked {
    border-color: var(--accent);
    background: var(--accent);
  }

  .switch:checked::before {
    left: 22px;
    width: 24px;
    height: 24px;
    background: #fff;
  }

  .switch:disabled {
    opacity: 0.38;
    cursor: default;
  }

  .link {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    text-decoration: none;
  }

  /* Phones: the app bar names the page; cards run edge to edge of the gutter. */
  @media (max-width: 800px) {
    .page {
      grid-column: 1 / -1;
      padding: 0 0.75rem 2rem;
    }

    h1 {
      display: none;
    }

    section {
      padding: 1rem;
    }
  }
</style>
