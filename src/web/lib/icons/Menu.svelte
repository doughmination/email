<!-- src/web/lib/icons/Menu.svelte
     Licensed under the DASL-1.0 Licence — (c) Clove Twilight
-->

<script lang="ts">
  import Icon from "./Icon.svelte";

  let props: { size?: number; class?: string; [key: string]: unknown } = $props();
</script>

<!-- Material "menu" -->
<Icon svg={`<path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/>`} {...props} />
