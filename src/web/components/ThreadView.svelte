<!-- mailbox/src/web/components/ThreadView.svelte
     Copyright (c) 2026 Clove Nytrix Doughmination Twilight
     Licensed under the DASL-1.0 Licence.
     See LICENCE.md in the project root for full licence information. -->
<script lang="ts">
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import Forward from "@lucide/svelte/icons/forward";
  import MailOpen from "@lucide/svelte/icons/mail-open";
  import Paperclip from "@lucide/svelte/icons/paperclip";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Reply from "@lucide/svelte/icons/reply";
  import Trash from "@lucide/svelte/icons/trash";
  import type { Message, Thread } from "../../shared/types";
  import { SvelteSet } from "svelte/reactivity";
  import { api } from "../lib/api";
  import { fmtSize, fmtTime } from "../lib/format";
  import { router } from "../lib/router.svelte";
  import { changed, composeDraft, composeForward, composeReply } from "../lib/state.svelte";
  import EmailFrame from "./EmailFrame.svelte";

  let { id }: { id: string } = $props();

  let thread = $state<Thread | null>(null);
  let error = $state("");
  /** Deletes need a second click; holds what's armed. */
  let confirming = $state<string | null>(null);

  $effect(() => {
    const threadId = id;
    let stale = false;
    thread = null;
    error = "";
    confirming = null;
    opened.clear();
    api
      .thread(threadId)
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

  async function markUnread() {
    changed((await api.markThread(id, false)).unread);
    router.thread(null);
  }

  async function removeThread() {
    if (confirming !== "thread") return void (confirming = "thread");
    await api.deleteThread(id);
    changed();
    router.thread(null);
  }

  async function removeMessage(m: Message) {
    if (confirming !== m.id) return void (confirming = m.id);
    await api.deleteMessage(m.id);
    changed();
    if (thread && thread.messages.length === 1) return router.thread(null);
    if (thread) thread.messages = thread.messages.filter((x) => x.id !== m.id);
    confirming = null;
  }

  const files = (m: Message) => m.attachments.filter((a) => !a.contentId || !m.html?.includes(a.contentId));
  const isImage = (type: string) => /^image\/(png|jpe?g|gif|webp|avif|bmp)$/i.test(type);
</script>

<article class="view">
  <button class="btn back" onclick={() => router.thread(null)}><ArrowLeft size={14} /> Back</button>

  {#if error}
    <p class="error">{error}</p>
  {:else if !thread}
    <p class="muted">Loading…</p>
  {:else}
    <h2>{thread.subject || "(no subject)"}</h2>

    {#if last}
      <div class="actions">
        <button class="btn accent" onclick={() => composeReply(last)}><Reply size={14} /> Reply</button>
        <button class="btn" onclick={() => composeForward(last)}><Forward size={14} /> Forward</button>
        {#if hasInbound}
          <button class="btn" onclick={markUnread}><MailOpen size={14} /> Mark unread</button>
        {/if}
        <button class="btn danger" onclick={removeThread}>
          <Trash size={14} />
          {confirming === "thread" ? "Click again to delete" : "Delete conversation"}
        </button>
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
            <strong>{m.from}</strong>
            {#if open}
              <span class="muted">to {m.to.join(", ")}{m.cc.length ? `, cc ${m.cc.join(", ")}` : ""}{m.bcc.length ? `, bcc ${m.bcc.join(", ")}` : ""}</span>
            {:else}
              <span class="muted snippet">{m.snippet}</span>
            {/if}
          </button>
          <div class="right">
            <time class="muted">{open ? new Date(m.sentAt).toLocaleString() : fmtTime(m.sentAt)}</time>
            {#if open}
              {#if m.folder === "drafts"}
                <button class="btn icon" title="Edit draft" onclick={() => composeDraft(m)}><Pencil size={14} /></button>
              {/if}
              <button
                class="btn icon"
                class:danger={confirming === m.id}
                title={confirming === m.id ? "Click again to delete" : "Delete this message"}
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
  {/if}
</article>

<style>
  .view {
    overflow-y: auto;
    padding-right: 0.25rem;
  }

  .back {
    display: none;
    margin-bottom: 1rem;
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

  @media (max-width: 800px) {
    .back {
      display: inline-flex;
    }
  }
</style>
