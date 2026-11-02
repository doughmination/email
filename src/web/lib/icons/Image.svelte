<!-- src/web/lib/icons/Image.svelte
     Licensed under the DASL-1.0 Licence — (c) Clove Twilight
-->

<script lang="ts">
  import Icon from "./Icon.svelte";

  let props: { size?: number; class?: string; [key: string]: unknown } = $props();
</script>

<!-- Material "image" -->
<Icon svg={`<path d="M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-4.86 8.86-3 3.87L9 13.14 6 17h12l-3.86-5.14z"/>`} {...props} />
