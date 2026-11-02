<!-- src/web/lib/icons/ChevronDown.svelte
     Licensed under the DASL-1.0 Licence — (c) Clove Twilight
-->

<script lang="ts">
  import Icon from "./Icon.svelte";

  let props: { size?: number; class?: string; [key: string]: unknown } = $props();
</script>

<!-- Material "expand_more" -->
<Icon svg={`<path d="M16.59 8.59 12 13.17 7.41 8.59 6 10l6 6 6-6-1.41-1.41z"/>`} {...props} />
