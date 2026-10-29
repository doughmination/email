<!-- src/web/lib/icons/Star.svelte
     Licensed under the DASL-1.0 Licence — (c) Clove Twilight
-->

<script lang="ts">
  import Icon from "./Icon.svelte";

  // `fill="currentColor"` (lucide's way of saying starred) becomes iconsax's solid style
  let {
    fill = "none",
    ...props
  }: {
    fill?: string;
    size?: number;
    class?: string;
    [key: string]: unknown;
  } = $props();
</script>

<Icon name="star" type={fill === "none" ? "linear" : "bold"} {...props} />
