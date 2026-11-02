<!-- mailbox/src/web/components/ThreadView.svelte
     Copyright (c) 2026 Clove Nytrix Doughmination Twilight
     Licensed under the DASL-1.0 Licence.
     See LICENCE.md in the project root for full licence information. -->
<script lang="ts">
  import ArchiveRestore from "../lib/icons/ArchiveRestore.svelte";
  import ArrowLeft from "../lib/icons/ArrowLeft.svelte";
  import CircleX from "../lib/icons/CircleX.svelte";
  import Forward from "../lib/icons/Forward.svelte";
  import LoaderCircle from "../lib/icons/LoaderCircle.svelte";
  import MarkUnread from "../lib/icons/MarkUnread.svelte";
  import Paperclip from "../lib/icons/Paperclip.svelte";
  import Pencil from "../lib/icons/Pencil.svelte";
  import Reply from "../lib/icons/Reply.svelte";
  import Star from "../lib/icons/Star.svelte";
  import Trash from "../lib/icons/Trash.svelte";
  import type { Message, Thread } from "../../shared/types";
  import { SvelteSet } from "svelte/reactivity";
  import { api } from "../lib/api";
  import { bareAddress, displayName, fmtSize, fmtTime } from "../lib/format";
  import { router } from "../lib/router.svelte";
  import { changed, composeDraft, composeForward, composeReply, composer, session } from "../lib/state.svelte";
  import EmailFrame from "./EmailFrame.svelte";

  /** `bin`: showing the part of the thread that's in the Bin. */
  let { id, bin = false }: { id: string; bin?: boolean } = $props();

  let thread = $state<Thread | null>(null);
  let error = $state("");
  /** Deleting forever needs a second click; holds what's armed. Moving to the Bin doesn't. */
  let confirming = $state<string | null>(null);

  $effect(() => {
    const threadId = id;
    const inBin = bin;
    let stale = false;
    thread = null;
    error = "";
    confirming = null;
    opened.clear();
    api
      .thread(threadId, inBin)
      .then((t) => {
        if (stale) return;
        thread = t;
        // Failing to mark it read shouldn't hide a thread that loaded fine.
        if (t.messages.some((m) => !m.read)) {
          api.markThread(threadId, true).then(
            (r) => changed(r.unread),
            (e: Error) => console.warn("Could not mark thread read", e),
          );
        }
      })
      .catch((e: Error) => !stale && (error = e.message));
    return () => (stale = true);
  });

  // New mail arrived in this thread while it's open: fetch it again in place.
  let seenLive = session.liveThread?.n ?? 0;
  $effect(() => {
    const live = session.liveThread;
    if (!live || live.n === seenLive) return;
    seenLive = live.n;
    if (live.id !== id || !thread) return;
    const threadId = id;
    api.thread(threadId, bin).then(
      (t) => {
        if (threadId !== id) return;
        thread = t;
        if (t.messages.some((m) => !m.read)) {
          api.markThread(threadId, true).then(
            (r) => changed(r.unread),
            (e: Error) => console.warn("Could not mark thread read", e),
          );
        }
      },
      (e: Error) => console.warn("Could not refresh thread", e),
    );
  });

  const last = $derived(thread?.messages.filter((m) => m.folder !== "drafts").at(-1) ?? thread?.messages.at(-1));
  const hasInbound = $derived(thread?.messages.some((m) => m.folder === "inbox") ?? false);

  /** Oldest first, as the API sends them and the app shows them. */
  const newestId = $derived(thread?.messages.at(-1)?.id);
  /** Messages the user has opened or closed. The newest and unread ones start open. */
  const opened = new SvelteSet<string>();
  const isOpen = (m: Message) => (m.id === newestId || !m.read) !== opened.has(m.id);

  function toggle(m: Message) {
    if (opened.has(m.id)) opened.delete(m.id);
    else opened.add(m.id);
  }

  async function toggleStar() {
    if (!thread) return;
    const star = !thread.starred;
    thread.starred = star;
    try {
      await api.starThread(id, star);
      changed();
    } catch (e) {
      thread.starred = !star;
      error = (e as Error).message;
    }
  }

  async function markUnread() {
    changed((await api.markThread(id, false)).unread);
    router.thread(null);
  }

  /** To the Bin, or out of the Bin for good. */
  async function removeThread() {
    if (bin && confirming !== "thread") return void (confirming = "thread");
    await api.deleteThread(id, bin);
    changed();
    router.thread(null);
  }

  async function restoreThread() {
    await api.restoreThread(id);
    changed();
    router.thread(null);
  }

  /** Drops a message from this view once it's moved or gone. */
  function drop(m: Message) {
    changed();
    if (thread && thread.messages.length === 1) return router.thread(null);
    if (thread) thread.messages = thread.messages.filter((x) => x.id !== m.id);
    confirming = null;
  }

  async function removeMessage(m: Message) {
    if (bin && confirming !== m.id) return void (confirming = m.id);
    await api.deleteMessage(m.id, bin);
    drop(m);
  }

  async function restoreMessage(m: Message) {
    await api.restoreMessage(m.id);
    drop(m);
  }

  /** Delete/Backspace bins the thread, r replies, f forwards; never while typing or composing. */
  function onkeydown(e: KeyboardEvent) {
    if (composer.open || !thread || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if ((e.target as Element | null)?.closest?.("input, textarea, select, [contenteditable]")) return;
    const key = e.key.toLowerCase();
    if (key === "delete" || key === "backspace") {
      e.preventDefault();
      void removeThread();
    } else if (!bin && last && (key === "r" || key === "f")) {
      e.preventDefault();
      (key === "r" ? composeReply : composeForward)(last);
    }
  }

  const files = (m: Message) => m.attachments.filter((a) => !a.contentId || !m.html?.includes(a.contentId));
  const isImage = (type: string) => /^image\/(png|jpe?g|gif|webp|avif|bmp)$/i.test(type);
</script>

<svelte:window {onkeydown} />

<article class="view">
  <!-- Phones: the app's top bar, back on the left and actions on the right. -->
  <div class="topbar">
    <button class="tb" aria-label="Back" onclick={() => router.thread(null)}><ArrowLeft size={24} /></button>
    {#if thread && bin}
      <button class="tb" aria-label="Restore" title="Restore" onclick={restoreThread}><ArchiveRestore size={24} /></button>
      <button
        class="tb"
        class:armed={confirming === "thread"}
        aria-label={confirming === "thread" ? "Tap again to delete forever" : "Delete forever"}
        title={confirming === "thread" ? "Tap again to delete forever" : "Delete forever"}
        onclick={removeThread}
      >
        <CircleX size={24} />
      </button>
    {:else if thread && last}
      <button
        class="tb"
        class:starred={thread.starred}
        aria-label={thread.starred ? "Unstar" : "Star"}
        aria-pressed={thread.starred}
        onclick={toggleStar}
      >
        <Star size={24} fill={thread.starred ? "currentColor" : "none"} />
      </button>
      {#if hasInbound}
        <button class="tb" aria-label="Mark as unread" title="Mark as unread" onclick={markUnread}><MarkUnread size={24} /></button>
      {/if}
      <button class="tb" aria-label="Move to Bin" title="Move to Bin" onclick={removeThread}><Trash size={24} /></button>
    {/if}
  </div>

  {#if error}
    <p class="error pad">{error}</p>
  {:else if !thread}
    <p class="loading"><LoaderCircle size={40} /></p>
  {:else}
    <h2>{thread.subject || "(no subject)"}</h2>

    <!-- Wide screens have no top bar, so the thread's actions sit here. -->
    {#if bin}
      <div class="actions">
        <button class="btn accent" onclick={restoreThread}><ArchiveRestore size={18} /> Restore</button>
        <button class="btn danger" title="Delete forever (Del)" onclick={removeThread}>
          <CircleX size={18} />
          {confirming === "thread" ? "Click again to delete forever" : "Delete forever"}
        </button>
      </div>
    {:else if last}
      <div class="actions">
        <button class="btn accent" title="Reply (R)" onclick={() => composeReply(last)}><Reply size={18} /> Reply</button>
        <button class="btn" title="Forward (F)" onclick={() => composeForward(last)}><Forward size={18} /> Forward</button>
        <button class="btn" class:starred={thread.starred} aria-pressed={thread.starred} onclick={toggleStar}>
          <Star size={18} fill={thread.starred ? "currentColor" : "none"} />
          {thread.starred ? "Starred" : "Star"}
        </button>
        {#if hasInbound}
          <button class="btn" onclick={markUnread}><MarkUnread size={18} /> Mark as unread</button>
        {/if}
        <button class="btn danger" title="Move to Bin (Del)" onclick={removeThread}><Trash size={18} /> Move to Bin</button>
      </div>
    {/if}

    {#each thread.messages as m (m.id)}
      {@const open = isOpen(m)}
      {@const draft = m.folder === "drafts"}
      <!-- The app's message card: tap the header to open or close it. -->
      <section class="message">
        <button class="head" onclick={() => toggle(m)} aria-expanded={open}>
          <span class="top">
            <strong class:draft title={m.from}>{draft ? "Draft" : displayName(m.from)}</strong>
            <time title={new Date(m.sentAt).toLocaleString()}>{fmtTime(m.sentAt)}</time>
          </span>
          {#if !open}
            <span class="line">{m.snippet}</span>
          {:else}
            <span class="small">{bareAddress(m.from)}</span>
            {#if m.to.length}<span class="small">To: {m.to.join(", ")}</span>{/if}
            {#if m.cc.length}<span class="small">Cc: {m.cc.join(", ")}</span>{/if}
            {#if m.bcc.length}<span class="small">Bcc: {m.bcc.join(", ")}</span>{/if}
          {/if}
        </button>

        {#if open}
          {#if m.html}
            <EmailFrame html={m.html} attachments={m.attachments} />
          {:else}
            <pre>{m.text ?? "(empty message)"}</pre>
          {/if}

          {#if files(m).length}
            <ul class="files">
              {#each files(m) as a (a.id)}
                <li>
                  {#if isImage(a.contentType)}
                    <a class="preview" href={api.attachmentUrl(a.id, true)} target="_blank" rel="noopener">
                      <img src={api.attachmentUrl(a.id, true)} alt={a.filename} />
                    </a>
                  {/if}
                  <a class="chip" href={api.attachmentUrl(a.id)} download={a.filename}>
                    <Paperclip size={18} />
                    <span>{a.filename} · {fmtSize(a.size)}</span>
                  </a>
                </li>
              {/each}
            </ul>
          {/if}

          <div class="foot">
            {#if draft && !bin}
              <button class="btn text" onclick={() => composeDraft(m)}><Pencil size={18} /> Edit</button>
            {:else if !bin}
              <button class="btn text" onclick={() => composeReply(m)}><Reply size={18} /> Reply</button>
              <button class="btn text" onclick={() => composeForward(m)}><Forward size={18} /> Forward</button>
            {/if}
            <span class="spacer"></span>
            {#if bin}
              <button class="btn icon" title="Restore this message" aria-label="Restore this message" onclick={() => restoreMessage(m)}>
                <ArchiveRestore size={24} />
              </button>
            {/if}
            <button
              class="btn icon"
              class:danger={confirming === m.id}
              title={confirming === m.id ? "Tap again to delete forever" : bin ? "Delete forever" : "Move to Bin"}
              aria-label={confirming === m.id ? "Tap again to delete forever" : bin ? "Delete forever" : "Move to Bin"}
              onclick={() => removeMessage(m)}
            >
              <Trash size={24} />
            </button>
          </div>
        {/if}
      </section>
    {/each}
  {/if}
</article>

<style>
  .view {
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
    overflow-y: auto;
    padding: 0 0.25rem 1rem 0;
  }

  .topbar {
    display: none;
  }

  .pad {
    padding: 1rem;
  }

  .loading {
    display: grid;
    place-items: center;
    margin: 0;
    padding: 3rem;
  }

  /* Material's headlineSmall, as the app titles a conversation. */
  h2 {
    margin: 0.5rem 0.25rem 0.25rem;
    font-size: 1.5rem;
    font-weight: 400;
    line-height: 1.33;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin: 0 0.25rem 0.25rem;
  }

  /* Material's card, filled with the same faint white as the app's. */
  .message {
    flex-shrink: 0;
    border-radius: 0.75rem;
    background: rgb(255 255 255 / 5%);
    overflow: hidden;
  }

  .head {
    display: flex;
    flex-direction: column;
    width: 100%;
    padding: 0.875rem;
    border: none;
    background: none;
    color: inherit;
    font-size: 1rem;
    text-align: left;
    cursor: pointer;
  }

  .top {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .top strong {
    flex: 1;
    overflow: hidden;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .top strong.draft {
    color: var(--danger);
  }

  time,
  .small {
    color: var(--muted);
    font-size: 0.75rem;
    font-weight: 500;
  }

  time {
    white-space: nowrap;
  }

  .small {
    overflow-wrap: anywhere;
  }

  .line {
    overflow: hidden;
    color: var(--muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  pre {
    margin: 0;
    padding: 0 0.875rem;
    font-family: var(--mono);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  /* Attachments as Material assist chips; images get a preview above. */
  .files {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    list-style: none;
    margin: 0;
    padding: 0.5rem 0.875rem;
  }

  .files li {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.4rem;
    min-width: 0;
  }

  .files img {
    display: block;
    max-width: 160px;
    max-height: 120px;
    border-radius: 0.5rem;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    max-width: 100%;
    min-height: 2rem;
    padding: 0 1rem 0 0.5rem;
    border: 1px solid var(--outline);
    border-radius: 0.5rem;
    color: var(--text);
    font-size: 0.875rem;
    font-weight: 500;
    text-decoration: none;
  }

  .chip :global(svg) {
    color: var(--accent);
  }

  .chip span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chip:hover {
    background: rgb(255 255 255 / 8%);
    color: var(--text);
  }

  .foot {
    display: flex;
    align-items: center;
    padding: 0.25rem;
  }

  .spacer {
    flex: 1;
  }

  .starred {
    color: var(--star);
  }

  /* Phones: one screen at a time, under the app's top bar. */
  @media (max-width: 800px) {
    .view {
      padding: 0 0.75rem 2rem;
    }

    .topbar {
      position: sticky;
      top: 0;
      z-index: 2;
      display: flex;
      justify-content: flex-end;
      align-items: center;
      min-height: 4rem;
      margin: 0 -0.75rem;
      padding: env(safe-area-inset-top) 0.25rem 0;
      background: var(--bg);
    }

    .tb {
      display: grid;
      place-items: center;
      width: 3rem;
      height: 3rem;
      padding: 0;
      border: none;
      border-radius: 50%;
      background: none;
      color: var(--muted);
      cursor: pointer;
    }

    .tb:first-child {
      margin-right: auto;
      color: var(--text);
    }

    .tb:hover {
      background: rgb(255 255 255 / 8%);
    }

    .tb.armed {
      color: var(--danger);
    }

    .tb.starred {
      color: var(--star);
    }

    .actions {
      display: none;
    }
  }
</style>
