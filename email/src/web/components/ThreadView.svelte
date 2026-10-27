<!-- mailbox/src/web/components/ThreadView.svelte
     Copyright (c) 2026 Clove Nytrix Doughmination Twilight
     Licensed under the DASL-1.0 Licence.
     See LICENCE.md in the project root for full licence information. -->
<script lang="ts">
  import ArchiveRestore from "@lucide/svelte/icons/archive-restore";
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import Forward from "@lucide/svelte/icons/forward";
  import MailOpen from "@lucide/svelte/icons/mail-open";
  import Paperclip from "@lucide/svelte/icons/paperclip";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Reply from "@lucide/svelte/icons/reply";
  import Star from "@lucide/svelte/icons/star";
  import Trash from "@lucide/svelte/icons/trash";
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

  /** Newest first. The API sends them oldest first. */
  const newestFirst = $derived(thread ? [...thread.messages].sort((a, b) => b.sentAt - a.sentAt) : []);
  const newestId = $derived(newestFirst[0]?.id);
  /** Older messages the user has opened; the newest is always open. */
  const opened = new SvelteSet<string>();
  const isOpen = (m: Message) => m.id === newestId || opened.has(m.id);

  function toggle(m: Message) {
    if (m.id === newestId) return;
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

  /** "Ari Lane" for "Ari Lane <ari@x.y>", or the address when there's no name. */
  const names = (list: string[]) => list.map(displayName).join(", ");

  const files = (m: Message) => m.attachments.filter((a) => !a.contentId || !m.html?.includes(a.contentId));
  const isImage = (type: string) => /^image\/(png|jpe?g|gif|webp|avif|bmp)$/i.test(type);
</script>

<svelte:window {onkeydown} />

<article class="view">
  <!-- Phones: back arrow on the left, icon actions on the right. -->
  <div class="topbar">
    <button class="tb" aria-label="Back" onclick={() => router.thread(null)}><ArrowLeft size={20} /></button>
    {#if thread && bin}
      <button class="tb" aria-label="Restore" title="Restore" onclick={restoreThread}><ArchiveRestore size={20} /></button>
      <button
        class="tb"
        class:armed={confirming === "thread"}
        aria-label="Delete forever"
        title={confirming === "thread" ? "Press again to delete forever" : "Delete forever"}
        onclick={removeThread}
      >
        <Trash size={20} />
      </button>
    {:else if thread && last}
      <button
        class="tb"
        class:starred={thread.starred}
        aria-label={thread.starred ? "Unstar" : "Star"}
        aria-pressed={thread.starred}
        onclick={toggleStar}
      >
        <Star size={20} fill={thread.starred ? "currentColor" : "none"} />
      </button>
      <button class="tb" aria-label="Move to Bin" title="Move to Bin" onclick={removeThread}><Trash size={20} /></button>
      {#if hasInbound}
        <button class="tb" aria-label="Mark unread" title="Mark unread" onclick={markUnread}><MailOpen size={20} /></button>
      {/if}
    {/if}
  </div>
  {#if bin && confirming === "thread"}<p class="armed-note error">Tap the bin again to delete forever.</p>{/if}

  {#if error}
    <p class="error">{error}</p>
  {:else if !thread}
    <p class="muted">Loading…</p>
  {:else}
    <h2>{thread.subject || "(no subject)"}</h2>

    {#if bin}
      <div class="actions">
        <button class="btn accent" onclick={restoreThread}><ArchiveRestore size={14} /> Restore</button>
        <button class="btn danger" title="Delete forever (Del)" onclick={removeThread}>
          <Trash size={14} />
          {confirming === "thread" ? "Press again to delete forever" : "Delete forever"}
        </button>
      </div>
    {:else if last}
      <div class="actions">
        <button class="btn accent" title="Reply (R)" onclick={() => composeReply(last)}><Reply size={14} /> Reply</button>
        <button class="btn" title="Forward (F)" onclick={() => composeForward(last)}><Forward size={14} /> Forward</button>
        <button class="btn" class:starred={thread.starred} aria-pressed={thread.starred} onclick={toggleStar}>
          <Star size={14} fill={thread.starred ? "currentColor" : "none"} />
          {thread.starred ? "Starred" : "Star"}
        </button>
        {#if hasInbound}
          <button class="btn" onclick={markUnread}><MailOpen size={14} /> Mark unread</button>
        {/if}
        <button class="btn danger" title="Move to Bin (Del)" onclick={removeThread}><Trash size={14} /> Delete</button>
      </div>
    {/if}

    {#each newestFirst as m (m.id)}
      {@const open = isOpen(m)}
      <section class="message" class:draft={m.folder === "drafts"} class:collapsed={!open}>
        <header>
          <button
            class="summary"
            onclick={() => toggle(m)}
            disabled={m.id === newestId}
            aria-expanded={open}
            title={m.id === newestId ? undefined : open ? "Collapse" : "Expand"}
          >
            <span class="badge {m.folder}">{m.folder === "inbox" ? "received" : m.folder === "sent" ? "sent" : "draft"}</span>
            <strong title={m.from}>{displayName(m.from)}</strong>
            {#if open}
              {#if displayName(m.from) !== bareAddress(m.from)}<span class="muted">&lt;{bareAddress(m.from)}&gt;</span>{/if}
              <span class="muted" title={[...m.to, ...m.cc, ...m.bcc].join(", ")}>
                to {names(m.to)}{m.cc.length ? `, cc ${names(m.cc)}` : ""}{m.bcc.length ? `, bcc ${names(m.bcc)}` : ""}
              </span>
            {:else}
              <span class="muted snippet">{m.snippet}</span>
            {/if}
          </button>
          <div class="right">
            <time class="muted">{open ? new Date(m.sentAt).toLocaleString() : fmtTime(m.sentAt)}</time>
            {#if open}
              {#if m.folder === "drafts" && !bin}
                <button class="btn icon" title="Edit draft" onclick={() => composeDraft(m)}><Pencil size={14} /></button>
              {/if}
              {#if bin}
                <button class="btn icon" title="Restore this message" onclick={() => restoreMessage(m)}>
                  <ArchiveRestore size={14} />
                </button>
              {/if}
              <button
                class="btn icon"
                class:danger={confirming === m.id}
                title={confirming === m.id ? "Click again to delete forever" : bin ? "Delete forever" : "Move to Bin"}
                onclick={() => removeMessage(m)}
              >
                <Trash size={14} />
              </button>
            {/if}
            {#if m.id !== newestId}
              <button class="btn icon chevron" class:open title={open ? "Collapse" : "Expand"} onclick={() => toggle(m)}>
                <ChevronDown size={14} />
              </button>
            {/if}
          </div>
        </header>

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
                  <a href={api.attachmentUrl(a.id, true)} target="_blank" rel="noopener">
                    <img src={api.attachmentUrl(a.id, true)} alt={a.filename} />
                  </a>
                {/if}
                <a href={api.attachmentUrl(a.id)} download={a.filename}><Paperclip size={12} /> {a.filename}</a>
                <span class="muted">({fmtSize(a.size)})</span>
              </li>
            {/each}
          </ul>
        {/if}
        {/if}
      </section>
    {/each}

    {#if !bin && last}
      <div class="replies">
        <button class="btn" onclick={() => composeReply(last)}><Reply size={16} /> Reply</button>
        <button class="btn" onclick={() => composeForward(last)}><Forward size={16} /> Forward</button>
      </div>
    {/if}
  {/if}
</article>

<style>
  .view {
    overflow-y: auto;
    padding-right: 0.25rem;
  }

  .topbar,
  .armed-note,
  .replies {
    display: none;
  }

  h2 {
    margin: 0.5rem 0 1rem;
    font-size: 1.35rem;
    font-weight: 700;
    letter-spacing: -0.01em;
  }

  .message {
    margin-bottom: 0.75rem;
    padding: 1.25rem 1.5rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--panel);
    backdrop-filter: blur(14px);
  }

  .message.draft {
    border-style: dashed;
    border-color: var(--accent-line);
  }

  header {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.9rem;
    font-size: 0.85rem;
  }

  .right {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .badge {
    margin-right: 0.4rem;
    padding: 0.05rem 0.55rem;
    border: 1px solid var(--line);
    border-radius: 999px;
    color: var(--muted);
    font-size: 0.65rem;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .badge.inbox {
    border-color: var(--accent-line);
    background: var(--accent-dim);
    color: var(--accent);
  }

  pre {
    margin: 0;
    font-family: var(--font);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .files {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    list-style: none;
    margin: 0.9rem 0 0;
    padding: 0;
    font-size: 0.85rem;
  }

  .files li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem 0.4rem;
  }

  /* An image preview sits on its own line above the file name. */
  .files li > a:has(img) {
    flex-basis: 100%;
  }

  .files img {
    max-width: 160px;
    max-height: 120px;
    border-radius: var(--radius-sm);
    outline: 1px solid var(--line);
    transition: outline-color 0.15s ease;
  }

  .files a:hover img {
    outline-color: var(--accent);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  /* Collapsed: one line (sender, preview, time); click to open. */
  .message.collapsed {
    padding-block: 0.6rem;
    transition: border-color 0.15s ease;
  }

  .message.collapsed:hover {
    border-color: var(--accent-line);
  }

  .message.collapsed header {
    flex-wrap: nowrap;
    margin-bottom: 0;
  }

  .summary {
    display: flex;
    flex: 1;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.35rem;
    min-width: 0;
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font-size: inherit;
    text-align: left;
    cursor: pointer;
  }

  .summary:disabled {
    cursor: default;
  }

  .collapsed .summary {
    flex-wrap: nowrap;
  }

  .collapsed .summary strong {
    flex-shrink: 0;
  }

  .snippet {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .right time {
    white-space: nowrap;
  }

  .chevron :global(svg) {
    transition: transform 0.15s ease;
  }

  .chevron.open :global(svg) {
    transform: rotate(180deg);
  }

  /* Phones: full-bleed like Gmail's app, with flatter message cards. */
  @media (max-width: 800px) {
    .view {
      padding: 0 0 2rem;
    }

    .topbar {
      position: sticky;
      top: 0;
      z-index: 2;
      display: flex;
      justify-content: flex-end;
      gap: 0.25rem;
      padding: calc(0.4rem + env(safe-area-inset-top)) 0.5rem 0.4rem;
      background: var(--panel);
      backdrop-filter: blur(14px);
    }

    .tb {
      display: grid;
      place-items: center;
      width: 2.75rem;
      height: 2.75rem;
      padding: 0;
      border: none;
      border-radius: 50%;
      background: none;
      color: var(--text);
      cursor: pointer;
    }

    .tb:first-child {
      margin-right: auto;
    }

    .tb:hover {
      background: var(--raised-hover);
    }

    .tb.armed {
      background: rgb(255 92 122 / 14%);
      color: var(--danger);
    }

    .armed-note {
      display: block;
      margin: 0.5rem 1rem 0;
      font-size: 0.85rem;
    }

    .actions {
      display: none;
    }

    h2 {
      margin: 0.75rem 1rem 1rem;
      font-size: 1.3rem;
      font-weight: 500;
    }

    .message {
      margin: 0 0 0.5rem;
      padding: 1rem;
      border-width: 1px 0;
      border-radius: 0;
    }

    .message.collapsed {
      padding-block: 0.75rem;
    }

    .right time {
      font-size: 0.75rem;
    }

    .replies {
      display: flex;
      gap: 0.75rem;
      padding: 1rem;
    }

    .replies .btn {
      flex: 1;
      justify-content: center;
      padding-block: 0.65rem;
      font-size: 0.95rem;
    }
  }

  .starred {
    color: var(--star);
  }
</style>
