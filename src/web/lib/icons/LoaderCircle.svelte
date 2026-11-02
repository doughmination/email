<!-- src/web/lib/icons/LoaderCircle.svelte
     Licensed under the DASL-1.0 Licence — (c) Clove Twilight
-->

<script lang="ts">
  // A Material circular progress indicator, like the app's spinner. Spins by
  // itself; a `spin` class from the caller is harmless.
  let { size = 24, class: className = "" }: { size?: number; class?: string; [key: string]: unknown } = $props();
</script>

<svg class="loader {className}" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
  <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" pathLength="100" />
</svg>

<style>
  .loader {
    flex-shrink: 0;
    color: var(--accent);
    animation: loader-spin 1.4s linear infinite;
  }

  circle {
    stroke-dasharray: 60 100;
    animation: loader-arc 1.4s ease-in-out infinite;
  }

  @keyframes loader-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @keyframes loader-arc {
    0% {
      stroke-dasharray: 5 100;
      stroke-dashoffset: 0;
    }
    50% {
      stroke-dasharray: 70 100;
      stroke-dashoffset: -15;
    }
    100% {
      stroke-dasharray: 5 100;
      stroke-dashoffset: -100;
    }
  }
</style>
