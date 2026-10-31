<!-- src/web/lib/icons/Plus.svelte
     Licensed under the DASL-1.0 Licence — (c) Clove Twilight
-->

<script lang="ts">
  import Icon from "./Icon.svelte";

  let props: { size?: number; class?: string; [key: string]: unknown } = $props();
</script>

<!-- Material "add" -->
<Icon svg={`<path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>`} {...props} />
