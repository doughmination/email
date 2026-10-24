<!-- mailbox/src/web/components/Composer.svelte
     Copyright (c) 2026 Clove Nytrix Doughmination Twilight
     Licensed under the DASL-1.0 Licence.
     See LICENCE.md in the project root for full licence information. -->
<script lang="ts">
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import Paperclip from "@lucide/svelte/icons/paperclip";
  import Send from "@lucide/svelte/icons/send";
  import X from "@lucide/svelte/icons/x";
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
</script>

<div class="backdrop" role="presentation" onkeydown={(e) => e.key === "Escape" && close()}>
  <form class="composer" onsubmit={send}>
    <header>
      <h2>{form.title}</h2>
      <button type="button" class="btn icon" title="Close" onclick={close}><X size={16} /></button>
    </header>

    {#if addresses.length > 1}
      <label class="field">
        From
        <select bind:value={form.from}>
          {#each addresses as a (a)}<option value={a}>{a}</option>{/each}
        </select>
      </label>
    {/if}
    <!-- Not <label>s: a click on the caption would hit the first pill's remove button. -->
    <div class="field">To <RecipientInput bind:value={form.to} label="To" placeholder="someone@example.com, …" /></div>
    <div class="field">Cc <RecipientInput bind:value={form.cc} label="Cc" /></div>
    <div class="field">Bcc <RecipientInput bind:value={form.bcc} label="Bcc" /></div>
    <label class="field">Subject <input bind:value={form.subject} required /></label>
    <label class="field grow">Message <textarea bind:value={form.text} rows="12"></textarea></label>

    <div class="files">
      <input bind:this={fileInput} type="file" multiple hidden onchange={(e) => addFiles(e.currentTarget.files)} />
      <button type="button" class="btn" onclick={() => fileInput?.click()}><Paperclip size={14} /> Attach</button>
      {#if uploading}<LoaderCircle size={16} class="spin" />{/if}
      {#each form.attachments as a, i (a.id)}
        <span class="file">
          {a.filename} <span class="muted">({fmtSize(a.size)})</span>
          <button type="button" class="btn icon" title="Remove" onclick={() => form.attachments.splice(i, 1)}>
            <X size={12} />
          </button>
        </span>
      {/each}
    </div>
    {#if totalBytes > 40 * 1024 * 1024}
      <p class="error">Over 40 MB of attachments; Resend will refuse this.</p>
    {/if}

    {#if error}<p class="error">{error}</p>{/if}

    <footer>
      <button type="button" class="btn danger" onclick={discard} disabled={busy}>Discard</button>
      <button type="button" class="btn" onclick={save} disabled={busy || uploading > 0}>Save draft</button>
      <button type="submit" class="btn accent" disabled={busy || uploading > 0}><Send size={14} /> Send</button>
    </footer>
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

  /* The site's featured contact card: accent border, soft ring. */
  .composer {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    width: min(720px, 100%);
    max-height: 100%;
    overflow-y: auto;
    padding: 1.5rem;
    border: 1px solid var(--accent-line);
    border-radius: var(--radius);
    background:
      radial-gradient(80% 120% at 0% 0%, rgb(235 69 158 / 12%), transparent 70%),
      #131116;
    box-shadow: 0 0 0 4px var(--accent-dim);
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  h2 {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 700;
  }

  textarea {
    resize: vertical;
    min-height: 10rem;
  }

  .files {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
  }

  .file {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.15rem 0.2rem 0.15rem 0.75rem;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--raised);
  }

  footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
</style>
