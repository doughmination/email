<!-- mailbox/src/web/components/EmailFrame.svelte
     Copyright (c) 2026 Clove Nytrix Doughmination Twilight
     Licensed under the DASL-1.0 Licence.
     See LICENCE.md in the project root for full licence information. -->

<!--
  The only place email HTML is ever rendered.

  It goes into a sandboxed srcdoc iframe, so nothing in an email can reach the
  app: no script runs at all (no allow-scripts), forms can't submit, and its
  <style>/@font-face rules only apply inside the frame, which is what stops a
  custom font in one email from restyling the whole page.

  allow-same-origin is safe without allow-scripts, and needed twice over: so
  cid: images can load from /api/attachments with the session cookie, and so
  this component can size the frame and point links at new tabs.

  Remote content (images, fonts, stylesheets) stays blocked until asked for;
  it's mostly tracking pixels.
-->
<script lang="ts">
  import ImageIcon from "@lucide/svelte/icons/image";
  import type { AttachmentInfo } from "../../shared/types";

  let { html, attachments }: { html: string; attachments: AttachmentInfo[] } = $props();

  let frame = $state<HTMLIFrameElement>();
  let height = $state(80);
  let showRemote = $state(false);

  const BASE_STYLE =
    ":root{color-scheme:light}body{margin:0;padding:16px;background:#fff;color:#111;" +
    "font:14px/1.5 -apple-system,system-ui,sans-serif;overflow-wrap:anywhere}" +
    "img{max-width:100%;height:auto}pre{white-space:pre-wrap}table{max-width:100%}";

  const body = $derived.by(() => {
    const byCid = new Map(
      attachments.filter((a) => a.contentId).map((a) => [a.contentId!.toLowerCase(), a.id]),
    );
    return html.replace(/cid:([^"'\s>)]+)/gi, (whole, raw: string) => {
      const id = byCid.get(raw.replace(/^<|>$/g, "").toLowerCase());
      return id ? `/api/attachments/${id}?inline=1` : whole;
    });
  });

  const hasRemote = $derived(/(?:src|background|href)\s*=\s*["']?\s*https?:|url\(\s*["']?\s*https?:|@import/i.test(body));

  const srcdoc = $derived.by(() => {
    const remote = showRemote ? " https:" : "";
    const csp =
      `default-src 'none'; img-src 'self' data:${remote}; style-src 'unsafe-inline'${remote}; ` +
      `font-src data:${remote}; media-src 'none'; form-action 'none'`;
    return (
      `<!doctype html><html><head><meta charset="utf-8">` +
      `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
      `<meta name="referrer" content="no-referrer"><style>${BASE_STYLE}</style></head>` +
      `<body>${body}</body></html>`
    );
  });

  function onload() {
    const doc = frame?.contentDocument;
    if (!doc) return;
    for (const a of doc.querySelectorAll("a[href]")) {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    }
    const measure = () => (height = Math.max(doc.documentElement.scrollHeight, 40));
    measure();
    // Images arriving late change the height after load.
    new ResizeObserver(measure).observe(doc.documentElement);
  }
</script>

{#if hasRemote && !showRemote}
  <button class="btn remote" onclick={() => (showRemote = true)}>
    <ImageIcon size={14} /> Load remote images
  </button>
{/if}

<iframe
  bind:this={frame}
  title="Email content"
  sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
  referrerpolicy="no-referrer"
  {srcdoc}
  {onload}
  style:height="{height}px"
></iframe>

<style>
  /* Emails are designed for a light page, so the frame stays white. */
  iframe {
    display: block;
    width: 100%;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: #fff;
  }

  .remote {
    margin-bottom: 0.6rem;
  }
</style>
