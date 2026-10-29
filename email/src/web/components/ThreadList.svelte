<!-- mailbox/src/web/components/ThreadList.svelte
     Copyright (c) 2026 Clove Nytrix Doughmination Twilight
     Licensed under the DASL-1.0 Licence.
     See LICENCE.md in the project root for full licence information. -->
<script lang="ts">
  import ArchiveRestore from "../lib/icons/ArchiveRestore.svelte";
  import CircleX from "../lib/icons/CircleX.svelte";
  import Eye from "../lib/icons/Eye.svelte";
  import Mail from "../lib/icons/Mail.svelte";
  import MailOpen from "../lib/icons/MailOpen.svelte";
  import Paperclip from "../lib/icons/Paperclip.svelte";
  import Star from "../lib/icons/Star.svelte";
  import StarOff from "../lib/icons/StarOff.svelte";
  import Trash2 from "../lib/icons/Trash2.svelte";
  import { flip } from "svelte/animate";
  import { fly, slide } from "svelte/transition";
  import type { ListFolder, ThreadSummary } from "../../shared/types";
  import { api } from "../lib/api";
  import { displayName, fmtTime } from "../lib/format";
  import { router } from "../lib/router.svelte";
  import { changed, session } from "../lib/state.svelte";
  import ActionMenu, { type MenuItem } from "./ActionMenu.svelte";
  import SwipeRow, { type HoldPoint, type SwipeAction } from "./SwipeRow.svelte";

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

  // Rows taken out by a swipe or the menu collapse; a reload just swaps them.
  const collapsing = new Set<string>();

  let menu = $state<{
    thread: ThreadSummary;
    at: HoldPoint;
  } | null>(null);

  let undo = $state<{
    thread: ThreadSummary;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);

  function fail(e: unknown) {
    error = (e as Error).message;
    changed();
  }

  async function toggleRead(thread: ThreadSummary) {
    const read = thread.unread > 0;
    thread.unread = read ? 0 : 1;
    try {
      changed((await api.markThread(thread.id, read)).unread);
    } catch (e) {
      fail(e);
    }
  }

  async function toggleStar(thread: ThreadSummary) {
    const star = !thread.starred;
    thread.starred = star;
    if (!star && folder === "starred") takeOut(thread);
    try {
      await api.starThread(thread.id, star);
      changed();
    } catch (e) {
      fail(e);
    }
  }

  function takeOut(thread: ThreadSummary) {
    collapsing.add(thread.id);
    items = items.filter((item) => item.id !== thread.id);
    if (selected === thread.id) router.thread(null);
  }

  async function moveToBin(thread: ThreadSummary) {
    takeOut(thread);
    try {
      await api.deleteThread(thread.id);
      changed();
      if (undo) clearTimeout(undo.timer);
      undo = {
        thread,
        timer: setTimeout(() => (undo = null), 5000),
      };
    } catch (e) {
      fail(e);
    }
  }

  async function undoBin() {
    if (!undo) return;
    const { thread, timer } = undo;
    clearTimeout(timer);
    undo = null;
    try {
      await api.restoreThread(thread.id);
      changed();
    } catch (e) {
      fail(e);
    }
  }

  async function restore(thread: ThreadSummary) {
    takeOut(thread);
    try {
      await api.restoreThread(thread.id);
      changed();
    } catch (e) {
      fail(e);
    }
  }

  async function deleteForever(thread: ThreadSummary) {
    takeOut(thread);
    try {
      await api.deleteThread(thread.id, true);
      changed();
    } catch (e) {
      fail(e);
    }
  }

  function swipeRight(thread: ThreadSummary): SwipeAction | undefined {
    if (folder === "bin") {
      return {
        label: "Restore",
        icon: ArchiveRestore,
        tone: "accent",
        dismiss: true,
        run: () => restore(thread),
      };
    }
    if (folder !== "inbox" && folder !== "starred") return undefined;
    return {
      label: thread.unread ? "Read" : "Unread",
      icon: thread.unread ? MailOpen : Mail,
      tone: "accent",
      dismiss: false,
      run: () => toggleRead(thread),
    };
  }

  function swipeLeft(thread: ThreadSummary): SwipeAction | undefined {
    if (folder === "bin") return undefined;
    return {
      label: "Bin",
      icon: Trash2,
      tone: "danger",
      dismiss: true,
      run: () => moveToBin(thread),
    };
  }

  function menuItems(thread: ThreadSummary): MenuItem[] {
    const open: MenuItem = {
      label: "Open",
      icon: Eye,
      run: () => router.thread(thread.id),
    };
    if (folder === "bin") {
      return [
        open,
        {
          label: "Restore",
          icon: ArchiveRestore,
          run: () => restore(thread),
        },
        {
          label: "Delete forever",
          icon: CircleX,
          danger: true,
          confirm: "Tap again to delete forever",
          run: () => deleteForever(thread),
        },
      ];
    }
    const readToggle: MenuItem[] = folder === "inbox" || folder === "starred"
      ? [
          {
            label: thread.unread ? "Mark as read" : "Mark as unread",
            icon: thread.unread ? MailOpen : Mail,
            run: () => toggleRead(thread),
          },
        ]
      : [];
    return [
      open,
      {
        label: thread.starred ? "Unstar" : "Star",
        icon: thread.starred ? StarOff : Star,
        run: () => toggleStar(thread),
      },
      ...readToggle,
      {
        label: "Move to Bin",
        icon: Trash2,
        danger: true,
        run: () => moveToBin(thread),
      },
    ];
  }

  function who(t: ThreadSummary) {
    // The Bin and Starred mix folders; whoever it's from reads best there.
    return folder === "inbox" || folder === "bin" || folder === "starred" ? displayName(t.from) : `To: ${t.to.map(displayName).join(", ") || "(nobody yet)"}`;
  }

  /** Phones show a coloured initial beside each row, as Gmail does. */
  function avatar(t: ThreadSummary) {
    const name = folder === "inbox" || folder === "bin" || folder === "starred" ? displayName(t.from) : displayName(t.to[0] ?? "?");
    const letter = name.match(/\p{L}|\p{N}/u)?.[0]?.toUpperCase() ?? "?";
    let hue = 0;
    for (const c of name) hue = (hue * 31 + c.charCodeAt(0)) % 360;
    return { letter, hue };
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
      {@const a = avatar(t)}
      <li
        animate:flip={{ duration: 180 }}
        out:slide={{ duration: collapsing.delete(t.id) ? 180 : 0 }}
      >
        <SwipeRow
          swipeRight={swipeRight(t)}
          swipeLeft={swipeLeft(t)}
          onhold={(at) => (menu = { thread: t, at })}
        >
          <a
            href={router.href(`/${folder}/${t.id}${router.search}`)}
            class="row"
            class:selected={selected === t.id}
            class:unread={t.unread > 0}
            draggable="false"
          >
            <span class="avatar" style:--hue={a.hue} aria-hidden="true">{a.letter}</span>
            <div class="top">
              <span class="who">{who(t)}</span>
              {#if t.count > 1}<span class="n">{t.count}</span>{/if}
              {#if t.hasAttachments}<Paperclip size={12} />{/if}
              <time>{fmtTime(t.lastAt)}</time>
            </div>
            <div class="subject">{t.subject || "(no subject)"}</div>
            <div class="snippet">{t.snippet}</div>
          </a>
          {#if folder !== "bin"}
            <button
              class="star"
              class:on={t.starred}
              aria-label={t.starred ? "Unstar" : "Star"}
              aria-pressed={t.starred}
              onclick={() => toggleStar(t)}
            >
              <Star size={18} fill={t.starred ? "currentColor" : "none"} />
            </button>
          {/if}
        </SwipeRow>
      </li>
    {/each}
  </ul>

  {#if cursor}
    <button class="btn more" onclick={more} disabled={loading}>Load more</button>
  {/if}
</section>

{#if menu}
  <ActionMenu
    title={menu.thread.subject || "(no subject)"}
    items={menuItems(menu.thread)}
    at={menu.at}
    onclose={() => (menu = null)}
  />
{/if}

{#if undo}
  <div class="toast" role="status" transition:fly={{ y: 16, duration: 160 }}>
    <span>Moved to Bin</span>
    <button class="undo" onclick={undoBin}>Undo</button>
  </div>
{/if}

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

  /* Sits over the row's bottom-right corner, beside the snippet. */
  .star {
    position: absolute;
    right: 0.6rem;
    bottom: 0.45rem;
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: none;
    color: var(--muted);
    cursor: pointer;
  }

  .star:hover {
    background: var(--raised-hover);
    color: var(--text);
  }

  .star.on {
    color: var(--star);
  }

  .snippet {
    padding-right: 2rem;
  }

  .avatar {
    display: none;
  }

  /* Phones: flat full-width rows with an avatar, as in Gmail's app. */
  @media (max-width: 800px) {
    .list {
      border: none;
      border-radius: 0;
      background: transparent;
      backdrop-filter: none;
      padding-bottom: 6rem;
    }

    li {
      margin: 0 0.5rem;
    }

    .row {
      display: grid;
      grid-template-columns: 2.5rem minmax(0, 1fr);
      column-gap: 0.85rem;
      padding: 0.65rem 0.6rem;
      border-bottom: none;
      border-radius: var(--radius);
    }

    .row > :not(.avatar) {
      grid-column: 2;
    }

    .avatar {
      display: grid;
      grid-row: 1 / span 3;
      place-items: center;
      width: 2.5rem;
      height: 2.5rem;
      margin-top: 0.15rem;
      border-radius: 50%;
      background: hsl(var(--hue) 55% 42%);
      color: #fff;
      font-size: 1.05rem;
      font-weight: 600;
    }

    .row.selected {
      box-shadow: none;
    }

    .top {
      font-size: 0.95rem;
    }

    .row.unread .who::before {
      display: none;
    }

    .row.unread time {
      color: var(--text);
      font-weight: 700;
    }

    .subject {
      margin-top: 0;
      font-size: 0.9rem;
    }

    .snippet {
      font-size: 0.85rem;
    }

    .toast {
      right: auto;
      bottom: calc(5.5rem + env(safe-area-inset-bottom));
      left: 0.75rem;
      transform: none;
    }

    .bin-bar {
      margin: 0 0.75rem 0.5rem;
      border: 1px solid var(--line);
      border-radius: var(--radius);
    }
  }

  .toast {
    position: fixed;
    bottom: 1.25rem;
    left: 50%;
    z-index: 25;
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.5rem 0.5rem 0.5rem 1rem;
    transform: translateX(-50%);
    border: 1px solid var(--line);
    border-radius: 999px;
    background: rgb(22 19 26 / 96%);
    box-shadow: 0 6px 20px rgb(0 0 0 / 45%);
    font-size: 0.9rem;
  }

  .undo {
    padding: 0.35rem 0.85rem;
    border: none;
    border-radius: 999px;
    background: none;
    color: var(--accent);
    cursor: pointer;
    font-weight: 700;
  }

  .undo:hover {
    background: var(--accent-dim);
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
