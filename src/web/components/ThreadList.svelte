<!-- mailbox/src/web/components/ThreadList.svelte
     Copyright (c) 2026 Clove Nytrix Doughmination Twilight
     Licensed under the DASL-1.0 Licence.
     See LICENCE.md in the project root for full licence information. -->
<script lang="ts">
  import Paperclip from "@lucide/svelte/icons/paperclip";
  import type { Folder, ThreadSummary } from "../../shared/types";
  import { api } from "../lib/api";
  import { displayName, fmtTime } from "../lib/format";
  import { router } from "../lib/router.svelte";
  import { session } from "../lib/state.svelte";

  let { folder, selected }: { folder: Folder; selected: string | null } = $props();

  let items = $state<ThreadSummary[]>([]);
  let cursor = $state<string | null>(null);
  let loading = $state(false);
  let error = $state("");

  $effect(() => {
    // Reload when the folder, mailbox filter or session.version changes.
    const key = [folder, router.mailbox, session.version] as const;
    let stale = false;
    loading = true;
    error = "";
    api
      .threads(key[0], key[1])
      .then((page) => {
        if (stale) return;
        items = page.items;
        cursor = page.nextCursor;
      })
      .catch((e: Error) => !stale && (error = e.message))
      .finally(() => !stale && (loading = false));
    return () => (stale = true);
  });

  async function more() {
    if (!cursor) return;
    loading = true;
    try {
      const page = await api.threads(folder, router.mailbox, cursor);
      items = [...items, ...page.items];
      cursor = page.nextCursor;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  function who(t: ThreadSummary) {
    return folder === "inbox" ? displayName(t.from) : `To: ${t.to.map(displayName).join(", ") || "(nobody yet)"}`;
  }
</script>

<section class="list">
  {#if error}
    <p class="error pad">{error}</p>
  {:else if !items.length && !loading}
    <p class="muted pad">Nothing here.</p>
  {/if}

  <ul>
    {#each items as t (t.id)}
      <li>
        <a
          href="/{folder}/{t.id}{router.search}"
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
    background: var(--mantle);
    border-right: 2px solid var(--surface1);
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
    padding: 0.7rem 1rem;
    border-bottom: 1px solid var(--surface1);
    border-left: 3px solid transparent;
    color: var(--subtext1);
    text-decoration: none;
  }

  .row:hover {
    background: var(--surface0);
  }

  .row.selected {
    background: var(--surface0);
    border-left-color: var(--pink);
  }

  .row.unread {
    color: var(--text);
  }

  .row.unread .who,
  .row.unread .subject {
    font-weight: 700;
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
    color: var(--overlay0);
    font-size: 0.75rem;
  }

  time {
    margin-left: auto;
    color: var(--subtext0);
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
  }

  .snippet {
    color: var(--subtext0);
    font-size: 0.8rem;
  }

  .more {
    margin: 1rem;
  }
</style>
