<!-- src/web/lib/icons/Icon.svelte
     Licensed under the DASL-1.0 Licence — (c) Clove Twilight
-->

<script lang="ts">
  // One Material icon (outlined), the set the Android app uses. `svg` is the
  // icon's own markup, from @material-design-icons/svg; it's a constant in
  // each icon's component, never user input. Sized by `size`, or by a CSS class.
  let {
    svg,
    size = 24,
    class: className = "",
    ...rest
  }: {
    svg: string;
    size?: number;
    class?: string;
    [key: string]: unknown;
  } = $props();
</script>

<svg class="icon {className}" width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...rest}>
  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
  {@html svg}
</svg>

<style>
  .icon {
    flex-shrink: 0;
  }
</style>
