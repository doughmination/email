<!-- src/web/lib/icons/Icon.svelte
     Licensed under the DASL-1.0 Licence — (c) Clove Twilight
-->

<script lang="ts">
  // One iconsax icon, the set doughmination.gay uses. Sized by `size`, or by a CSS class
  let {
    name,
    size = 24,
    type = "bulk",
    class: className = "",
    ...rest
  }: {
    name: string;
    size?: number;
    type?: "bold" | "broken" | "bulk" | "linear" | "outline" | "twotone";
    class?: string;
    [key: string]: unknown;
  } = $props();
</script>

<iconsax-icon {name} {type} {size} class={className} aria-hidden="true" {...rest}></iconsax-icon>
