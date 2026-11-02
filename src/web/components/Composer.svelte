<!-- mailbox/src/web/components/Composer.svelte
     Copyright (c) 2026 Clove Nytrix Doughmination Twilight
     Licensed under the DASL-1.0 Licence.
     See LICENCE.md in the project root for full licence information. -->
<script lang="ts">
  import LoaderCircle from "../lib/icons/LoaderCircle.svelte";
  import MoreVert from "../lib/icons/MoreVert.svelte";
  import Paperclip from "../lib/icons/Paperclip.svelte";
  import Send from "../lib/icons/Send.svelte";
  import X from "../lib/icons/X.svelte";
  import type { AttachmentInfo, ComposeInput } from "../../shared/types";
  import { api, ApiError } from "../lib/api";
  import { fmtSize, isAddress } from "../lib/format";
  import { router } from "../lib/router.svelte";
  import { changed, composer, session, type ComposeInit } from "../lib/state.svelte";
  import RecipientInput from "./RecipientInput.svelte";

  let { init }: { init: ComposeInit } = $props();

  // Copied once: the form owns these from here on.
  // svelte-ignore state_referenced_locally
  let form = $state({ ...init, to: [...init.to], cc: [...init.cc], bcc: [...init.bcc], attachments: [...init.attachments] });
  let uploading = $state(0);
  let busy = $state(false);
  let error = $state("");
  let fileInput = $state<HTMLInputElement>();
  // svelte-ignore state_referenced_locally
  let showCopies = $state(init.cc.length > 0 || init.bcc.length > 0);
  let menu = $state(false);

  const addresses = $derived(session.me?.addresses ?? []);
  const totalBytes = $derived(form.attachments.reduce((n, a) => n + a.size, 0));

  function input(): ComposeInput {
    return {
      from: form.from,
      to: form.to,
      cc: form.cc,
      bcc: form.bcc,
      subject: form.subject,
      text: form.text,
      attachmentIds: form.attachments.map((a) => a.id),
      replyTo: form.replyTo,
    };
  }

  async function addFiles(files: FileList | null) {
    for (const file of files ?? []) {
      uploading++;
      try {
        const uploaded: AttachmentInfo = await api.upload(file);
        form.attachments.push(uploaded);
      } catch (e) {
        error = `${file.name}: ${(e as Error).message}`;
      } finally {
        uploading--;
      }
    }
    if (fileInput) fileInput.value = "";
  }

  /** The server would refuse these anyway, less readably. */
  function badAddress(): string {
    const bad = [...form.to, ...form.cc, ...form.bcc].find((a) => !isAddress(a));
    return bad ? `${bad} isn't an email address.` : "";
  }

  async function save() {
    if ((error = badAddress())) return;
    busy = true;
    error = "";
    try {
      form.draftId = form.draftId
        ? (await api.updateDraft(form.draftId, input())).id
        : (await api.createDraft(input())).id;
      changed();
      close();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  async function send(ev: SubmitEvent) {
    ev.preventDefault();
    if ((error = badAddress())) return;
    if (!form.to.length) return void (error = "Add at least one recipient.");
    busy = true;
    error = "";
    try {
      const sent = await api.send(input(), form.draftId);
      changed();
      close();
      router.go(`/sent/${sent.threadId}`);
    } catch (e) {
      // The server keeps it as a draft when Resend refuses it.
      if (e instanceof ApiError && typeof e.body.draftId === "string") form.draftId = e.body.draftId;
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  async function discard() {
    if (form.draftId) {
      await api.deleteMessage(form.draftId, true);
      changed();
    }
    close();
  }

  function close() {
    composer.open = null;
  }

  /** Closing keeps what's written as a draft, as the app does; an untouched one just goes. */
  function closeAndSave() {
    const blank =
      !form.draftId && !form.to.length && !form.cc.length && !form.bcc.length &&
      !form.subject.trim() && !form.text.trim() && !form.attachments.length;
    if (blank) close();
    else void save();
  }
</script>

<div class="backdrop" role="presentation" onkeydown={(e) => e.key === "Escape" && (menu ? (menu = false) : closeAndSave())}>
  <!-- The app's composer: a top bar with the actions, then one row per field. -->
  <form class="composer" onsubmit={send}>
    <header class="bar">
      <button type="button" class="btn icon" title="Close and save" aria-label="Close and save" onclick={closeAndSave} disabled={busy}>
        <X size={24} />
      </button>
      <h2>{form.title}</h2>
      <input bind:this={fileInput} type="file" multiple hidden onchange={(e) => addFiles(e.currentTarget.files)} />
      <button type="button" class="btn icon" title="Attach" aria-label="Attach" onclick={() => fileInput?.click()}>
        <Paperclip size={24} />
      </button>
      {#if busy || uploading}
        <span class="busy"><LoaderCircle size={24} /></span>
      {:else}
        <button type="submit" class="btn icon send" title="Send" aria-label="Send"><Send size={24} /></button>
      {/if}
      <div class="more">
        <button type="button" class="btn icon" title="More" aria-label="More" aria-expanded={menu} onclick={() => (menu = !menu)}>
          <MoreVert size={24} />
        </button>
        {#if menu}
          <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
          <div class="menu-scrim" onclick={() => (menu = false)}></div>
          <div class="menu" role="menu">
            <button type="button" role="menuitem" onclick={() => ((menu = false), save())} disabled={busy || uploading > 0}>Save draft</button>
            <button type="button" role="menuitem" class="danger" onclick={() => ((menu = false), discard())} disabled={busy}>
              {form.draftId ? "Delete draft" : "Discard"}
            </button>
          </div>
        {/if}
      </div>
    </header>

    <label class="row">
      <span class="cap">From</span>
      {#if addresses.length > 1}
        <select bind:value={form.from}>
          {#each addresses as a (a)}<option value={a}>{a}</option>{/each}
        </select>
      {:else}
        <span class="value">{form.from || "No address to send from"}</span>
      {/if}
    </label>
    <!-- Not <label>s: a click on the caption would hit the first pill's remove button. -->
    <div class="row">
      <span class="cap">To</span>
      <RecipientInput bind:value={form.to} label="To" />
      {#if !showCopies}<button type="button" class="btn text" onclick={() => (showCopies = true)}>Cc/Bcc</button>{/if}
    </div>
    {#if showCopies}
      <div class="row"><span class="cap">Cc</span> <RecipientInput bind:value={form.cc} label="Cc" /></div>
      <div class="row"><span class="cap">Bcc</span> <RecipientInput bind:value={form.bcc} label="Bcc" /></div>
    {/if}
    <label class="row"><span class="cap">Subject</span> <input bind:value={form.subject} /></label>

    {#if form.attachments.length || uploading}
      <div class="files">
        {#each form.attachments as a, i (a.id)}
          <span class="chip">
            <span class="name">{a.filename} · {fmtSize(a.size)}</span>
            <button type="button" title="Remove" aria-label="Remove {a.filename}" onclick={() => form.attachments.splice(i, 1)}>
              <X size={18} />
            </button>
          </span>
        {/each}
        {#if uploading}<span class="small">Uploading {uploading}…</span>{/if}
      </div>
    {/if}
    {#if totalBytes > 40 * 1024 * 1024}
      <p class="error note">Over 40 MB of attachments; Resend will refuse this.</p>
    {/if}
    {#if error}<p class="error note">{error}</p>{/if}

    <textarea bind:value={form.text} placeholder="Write your message" aria-label="Message"></textarea>
  </form>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 10;
    display: grid;
    place-items: center;
    padding: 1rem;
    background: rgb(11 10 13 / 70%);
    backdrop-filter: blur(6px);
  }

  /* Wide screens: a Material dialog holding the same layout as the app. */
  .composer {
    display: flex;
    flex-direction: column;
    width: min(720px, 100%);
    height: min(720px, 100%);
    overflow-y: auto;
    border-radius: 1.75rem;
    background: var(--surface-low);
  }

  .bar {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 0.25rem;
    min-height: 4rem;
    padding: 0 0.25rem;
    background: var(--surface-low);
  }

  h2 {
    flex: 1;
    margin: 0 0 0 0.25rem;
    overflow: hidden;
    font-size: 1.375rem;
    font-weight: 400;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bar .btn.icon {
    width: 3rem;
    min-height: 3rem;
    color: var(--text);
  }

  .bar .btn.icon.send {
    color: var(--accent);
  }

  .busy {
    display: grid;
    place-items: center;
    width: 3rem;
    height: 3rem;
  }

  .more {
    position: relative;
  }

  .menu-scrim {
    position: fixed;
    inset: 0;
    z-index: 1;
  }

  /* Material's dropdown menu. */
  .menu {
    position: absolute;
    top: 100%;
    right: 0;
    z-index: 2;
    display: flex;
    flex-direction: column;
    min-width: 12rem;
    padding: 0.5rem 0;
    border-radius: 0.25rem;
    background: var(--surface-high);
    box-shadow: 0 4px 12px rgb(0 0 0 / 45%);
  }

  .menu button {
    min-height: 3rem;
    padding: 0 0.75rem;
    border: none;
    background: none;
    color: var(--text);
    font-size: 0.875rem;
    font-weight: 500;
    text-align: left;
    cursor: pointer;
  }

  .menu button:hover:not(:disabled) {
    background: rgb(255 255 255 / 8%);
  }

  .menu button:disabled {
    opacity: 0.38;
  }

  .menu .danger {
    color: var(--danger);
  }

  /* One field per row, captioned in front and divided by a hairline. */
  .row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 3.5rem;
    padding: 0 1rem;
    border-bottom: 1px solid var(--outline-variant);
  }

  .cap {
    color: var(--muted);
  }

  .row input,
  .row select,
  .value {
    flex: 1;
    min-width: 0;
    padding: 0.75rem 0;
    border: none;
    background: transparent;
    color: var(--text);
    font-size: 1rem;
  }

  .row input:focus,
  .row select:focus {
    outline: none;
  }

  .row select option {
    background: var(--surface-high);
  }

  .row :global(.recipients) {
    flex: 1;
    min-width: 0;
    padding: 0.4rem 0;
    border: none;
    background: transparent;
    box-shadow: none;
    font-size: 1rem;
  }

  .row :global(.recipients:focus-within) {
    box-shadow: none;
  }

  .files {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.4rem;
    padding: 0.4rem 0.75rem;
    border-bottom: 1px solid var(--outline-variant);
  }

  /* Material's input chip. */
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    max-width: 100%;
    min-height: 2rem;
    padding: 0 0.5rem 0 0.75rem;
    border: 1px solid var(--outline);
    border-radius: 0.5rem;
    font-size: 0.875rem;
    font-weight: 500;
  }

  .chip .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chip button {
    display: grid;
    place-items: center;
    padding: 0;
    border: none;
    background: none;
    color: var(--muted);
    cursor: pointer;
  }

  .small {
    color: var(--muted);
    font-size: 0.75rem;
    font-weight: 500;
  }

  .note {
    margin: 0.5rem 1rem 0;
  }

  textarea {
    flex: 1;
    min-height: 17.5rem;
    padding: 1rem;
    border: none;
    background: transparent;
    color: var(--text);
    font-size: 1rem;
    resize: none;
  }

  textarea:focus {
    outline: none;
  }

  /* Phones: full screen, as the app's composer is. */
  @media (max-width: 800px) {
    .backdrop {
      padding: 0;
    }

    .composer {
      width: 100%;
      height: 100%;
      padding-bottom: env(safe-area-inset-bottom);
      border-radius: 0;
      background: var(--bg);
    }

    .bar {
      padding-top: env(safe-area-inset-top);
      background: var(--bg);
    }

    /* 16px, or iOS Safari zooms the page on focus. */
    .row input,
    .row select,
    textarea {
      font-size: 16px;
    }
  }
</style>
