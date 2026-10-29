<!-- mailbox/src/web/components/RecipientInput.svelte
     Copyright (c) 2026 Clove Nytrix Doughmination Twilight
     Licensed under the DASL-1.0 Licence.
     See LICENCE.md in the project root for full licence information. -->
<script lang="ts">
  import X from "../lib/icons/X.svelte";
  import { displayName, isAddress, splitList } from "../lib/format";

  let { value = $bindable(), label, placeholder = "" }: { value: string[]; label: string; placeholder?: string } =
    $props();

  let text = $state("");
  let input = $state<HTMLInputElement>();

  /** Turns typed text into pills, skipping any already there. */
  function commit(raw: string) {
    const fresh = splitList(raw).filter((a) => !value.includes(a));
    if (fresh.length) value = [...value, ...fresh];
  }

  /** Where the last , or ; outside quotes is: "Doe, Jane" <j@x.y> isn't two addresses. */
  function lastSeparator(s: string): number {
    let quoted = false;
    let at = -1;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '"') quoted = !quoted;
      else if (!quoted && (s[i] === "," || s[i] === ";")) at = i;
    }
    return at;
  }

  // Typing (or pasting) a comma locks in everything before it.
  function oninput() {
    const at = lastSeparator(text);
    if (at < 0) return;
    commit(text.slice(0, at));
    text = text.slice(at + 1).trimStart();
  }

  function onkeydown(e: KeyboardEvent) {
    // Enter locks in an address rather than sending half-written mail.
    if (e.key === "Enter") {
      e.preventDefault();
      commit(text);
      text = "";
    } else if (e.key === "Backspace" && !text && value.length) {
      e.preventDefault();
      value = value.slice(0, -1);
    }
  }

  function onblur() {
    commit(text);
    text = "";
  }

  function remove(i: number) {
    value = value.filter((_, j) => j !== i);
    input?.focus();
  }
</script>

<!-- Clicks anywhere in the box land in the text input. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="recipients" onclick={(e) => e.target === e.currentTarget && input?.focus()}>
  {#each value as addr, i (addr)}
    <span class="pill" class:bad={!isAddress(addr)} title={isAddress(addr) ? addr : `${addr} isn't an email address`}>
      {displayName(addr)}
      <button type="button" class="remove" aria-label="Remove {addr}" onclick={() => remove(i)}><X size={12} /></button>
    </span>
  {/each}
  <input
    bind:this={input}
    bind:value={text}
    aria-label={label}
    placeholder={value.length ? "" : placeholder}
    autocomplete="email"
    {oninput}
    {onkeydown}
    {onblur}
  />
</div>

<style>
  .recipients {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
    padding: 0.3rem 0.4rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: rgb(0 0 0 / 25%);
    color: var(--text);
    font-size: 0.95rem;
    font-weight: 400;
    letter-spacing: normal;
    text-transform: none;
    cursor: text;
    transition:
      border-color 0.15s ease,
      box-shadow 0.15s ease;
  }

  .recipients:focus-within {
    border-color: var(--accent-line);
    box-shadow: 0 0 0 4px var(--accent-dim);
  }

  input {
    flex: 1;
    min-width: 8rem;
    padding: 0.25rem 0.35rem;
    border: none;
    background: transparent;
    color: var(--text);
    font-size: inherit;
  }

  input:focus {
    outline: none;
  }

  .pill {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    max-width: 100%;
    padding: 0.1rem 0.15rem 0.1rem 0.65rem;
    border: 1px solid var(--accent-line);
    border-radius: 999px;
    background: var(--accent-dim);
    font-size: 0.85rem;
    white-space: nowrap;
  }

  .pill.bad {
    border-color: var(--danger);
    background: transparent;
    color: var(--danger);
  }

  .remove {
    display: inline-grid;
    place-items: center;
    padding: 0.15rem;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .remove:hover {
    background: var(--raised-hover);
  }
</style>
