<!-- mailbox/src/web/components/SwipeRow.svelte
     Copyright (c) 2026 Clove Nytrix Doughmination Twilight
     Licensed under the DASL-1.0 Licence.
     See LICENCE.md in the project root for full licence information. -->
<script lang="ts" module>
  import type { Component } from "svelte";

  export interface SwipeAction {
    label: string;
    icon: Component<{ size?: number }>;
    tone: "accent" | "danger";
    // Slides the row away; the list must then drop it.
    dismiss: boolean;
    run: () => void;
  }

  export interface HoldPoint {
    x: number;
    y: number;
    // Mouse gets a popover at the cursor, touch gets a bottom sheet.
    mouse: boolean;
  }
</script>

<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    swipeRight,
    swipeLeft,
    onhold,
    children,
  }: {
    swipeRight?: SwipeAction;
    swipeLeft?: SwipeAction;
    onhold: (point: HoldPoint) => void;
    children: Snippet;
  } = $props();

  const holdMs = 450;
  const slopPx = 10;
  const commitFraction = 0.35;

  let row: HTMLDivElement;
  let offset = $state(0);
  let dragging = $state(false);
  let leaving = $state(false);
  let armed = $state(false);

  let gesture: {
    pointerId: number;
    startX: number;
    startY: number;
    axis: "x" | "y" | null;
    held: boolean;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;

  // A drag or hold ends in a click on the link; this swallows it.
  let swallowClick = false;

  const revealed = $derived(offset > 0 ? swipeRight : offset < 0 ? swipeLeft : undefined);

  function threshold() {
    return row.clientWidth * commitFraction;
  }

  function onpointerdown(event: PointerEvent) {
    swallowClick = false;
    if (event.pointerType === "mouse" || leaving) return;
    const startX = event.clientX;
    const startY = event.clientY;
    gesture = {
      pointerId: event.pointerId,
      startX,
      startY,
      axis: null,
      held: false,
      timer: setTimeout(() => {
        if (!gesture) return;
        gesture.held = true;
        navigator.vibrate?.(12);
        onhold({
          x: startX,
          y: startY,
          mouse: false,
        });
      }, holdMs),
    };
  }

  function onpointermove(event: PointerEvent) {
    if (!gesture || event.pointerId !== gesture.pointerId || gesture.held) return;
    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;

    if (!gesture.axis) {
      if (Math.hypot(deltaX, deltaY) < slopPx) return;
      clearTimeout(gesture.timer);
      gesture.axis = Math.abs(deltaX) > Math.abs(deltaY) ? "x" : "y";
      if (gesture.axis === "x") {
        row.setPointerCapture(event.pointerId);
        dragging = true;
      }
    }
    if (gesture.axis !== "x") return;

    // Rubber-band when there's nothing to do that way.
    const action = deltaX > 0 ? swipeRight : swipeLeft;
    offset = action ? deltaX : deltaX * 0.15;

    const nowArmed = !!action && Math.abs(offset) > threshold();
    if (nowArmed && !armed) navigator.vibrate?.(8);
    armed = nowArmed;
  }

  function onpointerup(event: PointerEvent) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    clearTimeout(gesture.timer);
    const { axis, held } = gesture;
    gesture = null;
    dragging = false;
    if (held || axis === "x") swallowClick = true;
    if (axis !== "x") return;

    const action = revealed;
    const commit = armed && action;
    armed = false;
    if (!commit) return void (offset = 0);

    if (action.dismiss) {
      leaving = true;
      offset = Math.sign(offset) * row.clientWidth;
      setTimeout(action.run, 180);
    } else {
      offset = 0;
      action.run();
    }
  }

  function onpointercancel() {
    if (gesture) clearTimeout(gesture.timer);
    gesture = null;
    dragging = false;
    armed = false;
    if (!leaving) offset = 0;
  }

  // Desktop right-click, the menu key, and Android's own long-press menu.
  function oncontextmenu(event: MouseEvent) {
    event.preventDefault();
    if (gesture || swallowClick) return;
    const fromKeyboard = event.clientX === 0 && event.clientY === 0;
    const box = row.getBoundingClientRect();
    onhold({
      x: fromKeyboard ? box.left + 24 : event.clientX,
      y: fromKeyboard ? box.bottom : event.clientY,
      mouse: true,
    });
  }

  function onclickcapture(event: MouseEvent) {
    if (!swallowClick) return;
    swallowClick = false;
    event.preventDefault();
    event.stopPropagation();
  }
</script>

<div
  class="swipe"
  role="presentation"
  bind:this={row}
  {onpointerdown}
  {onpointermove}
  {onpointerup}
  {onpointercancel}
  {oncontextmenu}
  {onclickcapture}
>
  {#if revealed}
    {@const Icon = revealed.icon}
    <div
      class="under {revealed.tone}"
      class:right={offset > 0}
      class:armed
      aria-hidden="true"
    >
      <Icon size={20} />
      <span>{revealed.label}</span>
    </div>
  {/if}

  <div
    class="face"
    class:dragging
    class:moved={offset !== 0}
    style:transform={offset ? `translateX(${offset}px)` : undefined}
  >
    {@render children()}
  </div>
</div>

<style>
  .swipe {
    position: relative;
    overflow: hidden;
    touch-action: pan-y;
    -webkit-touch-callout: none;
    user-select: none;
  }

  .face {
    position: relative;
    transition: transform 0.18s ease-out;
  }

  .face.dragging {
    transition: none;
  }

  /* Opaque only while moved, so the wallpaper shows through at rest. */
  .face.moved {
    background: var(--bg);
  }

  .under {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: row-reverse;
    align-items: center;
    gap: 0.5rem;
    padding: 0 1.4rem;
    color: #fff;
    font-size: 0.85rem;
    font-weight: 600;
    transition: filter 0.15s ease;
  }

  .under.right {
    flex-direction: row;
  }

  .under.accent {
    background: rgb(235 69 158 / 55%);
  }

  .under.danger {
    background: rgb(255 92 122 / 55%);
  }

  .under.armed.accent {
    background: var(--accent);
  }

  .under.armed.danger {
    background: var(--danger);
  }

  .under :global(svg) {
    transition: transform 0.15s ease;
  }

  .under.armed :global(svg) {
    transform: scale(1.25);
  }

  /* Phones: rows are rounded cards, so the colour behind is too. */
  @media (max-width: 800px) {
    .swipe {
      border-radius: var(--radius);
    }
  }
</style>
