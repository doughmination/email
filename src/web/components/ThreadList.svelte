<!-- mailbox/src/web/components/ThreadList.svelte
     Copyright (c) 2026 Clove Nytrix Doughmination Twilight
     Licensed under the DASL-1.0 Licence.
     See LICENCE.md in the project root for full licence information. -->
<script lang="ts">
  import Paperclip from "@lucide/svelte/icons/paperclip";
  import type { ListFolder, ThreadSummary } from "../../shared/types";
  import { api } from "../lib/api";
  import { displayName, fmtTime } from "../lib/format";
  import { router } from "../lib/router.svelte";
  import { changed, session } from "../lib/state.svelte";

  let { folder, selected }: { folder: ListFolder; selected: string | null } = $props();

  let items = $state<ThreadSummary[]>([]);
  let cursor = $state<string | null>(null);
  let loading = $state(false);
  let error = $state("");
  let confirmEmpty = $state(false);
  /** Bumped on every reload; a response from an older one is dropped. */
  let generation = 0;

  $effect(() => {
    // Reload when the folder, mailbox filter or session.version changes.
    const key = [folder, router.mailbox, session.version] as const;
    const gen = ++generation;
    loading = true;
    error = "";
    api
      .threads(key[0], key[1])
      .then((page) => {
        if (gen !== generation) return;
        items = page.items;
        cursor = page.nextCursor;
      })
      .catch((e: Error) => gen === generation && (error = e.message))
      .finally(() => gen === generation && (loading = false));
  });

  async function more() {
    if (!cursor) return;
    const gen = generation;
    loading = true;
    try {
      const page = await api.threads(folder, router.mailbox, cursor);
      if (gen !== generation) return;
      items = [...items, ...page.items];
      cursor = page.nextCursor;
    } catch (e) {
      if (gen === generation) error = (e as Error).message;
    } finally {
      if (gen === generation) loading = false;
    }
  }

  async function emptyBin() {
    if (!confirmEmpty) return void (confirmEmpty = true);
    confirmEmpty = false;
    try {
      await api.emptyBin();
      if (selected) router.thread(null);
      changed();
    } catch (e) {
      error = (e as Error).message;
    }
  }

  function who(t: ThreadSummary) {
    // The Bin mixes folders; whoever it's from reads best there.
    return folder === "inbox" || folder === "bin" ? displayName(t.from) : `To: ${t.to.map(displayName).join(", ") || "(nobody yet)"}`;
  }
</script>

<section class="list">
  {#if folder === "bin" && items.length}
    <div class="bin-bar">
      <span class="muted">Deleted after 30 days.</span>
      <button class="btn danger" onclick={emptyBin} onblur={() => (confirmEmpty = false)}>
        {confirmEmpty ? "Click again to empty" : "Empty bin"}
      </button>
    </div>
  {/if}

  {#if error}
    <p class="error pad">{error}</p>
  {:else if !items.length && !loading}
    <p class="muted pad">Nothing here.</p>
  {/if}

  <ul>
    {#each items as t (t.id)}
      <li>
        <a
          href={router.href(`/${folder}/${t.id}${router.search}`)}
          class="row"
          class:selected={selected === t.id}
          class:unread={t.unread > 0}
        >
          <div class="top">
            <span class="who">{who(t)}</span>
            {#if t.count > 1}<span class="n">{t.count}</span>{/if}
            {#if t.hasAttachments}<Paperclip size={12} />{/if}
            <time>{fmtTime(t.lastAt)}</time>
          </div>
          <div class="subject">{t.subject || "(no subject)"}</div>
          <div class="snippet">{t.snippet}</div>
        </a>
      </li>
    {/each}
  </ul>

  {#if cursor}
    <button class="btn more" onclick={more} disabled={loading}>Load more</button>
  {/if}
</section>

<style>
  .list {
    overflow-y: auto;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--panel);
    backdrop-filter: blur(14px);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .pad {
    padding: 1rem;
  }

  .row {
    display: block;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--line);
    color: var(--muted);
    text-decoration: none;
    transition: background 0.15s ease;
  }

  li:last-child .row {
    border-bottom: none;
  }

  .row:hover {
    background: var(--raised-hover);
    color: var(--muted);
  }

  .row.selected {
    background: var(--accent-dim);
    box-shadow: inset 3px 0 0 var(--accent);
  }

  .row.unread {
    color: var(--text);
  }

  .row.unread .who,
  .row.unread .subject {
    font-weight: 700;
  }

  .row.unread .who::before {
    content: "";
    display: inline-block;
    width: 0.45rem;
    height: 0.45rem;
    margin-right: 0.4rem;
    border-radius: 50%;
    background: var(--accent);
    vertical-align: middle;
  }

  .top {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.85rem;
  }

  .who {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .n {
    color: var(--muted);
    font-size: 0.75rem;
  }

  time {
    margin-left: auto;
    color: var(--muted);
    font-size: 0.75rem;
    white-space: nowrap;
  }

  .subject,
  .snippet {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .subject {
    margin-top: 0.15rem;
    color: var(--text);
  }

  .snippet {
    color: var(--muted);
    font-size: 0.8rem;
  }

  .more {
    margin: 1rem;
  }

  .bin-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.6rem 1rem;
    border-bottom: 1px solid var(--line);
    font-size: 0.8rem;
  }
</style>
