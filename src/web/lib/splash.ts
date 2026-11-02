/* mailbox/src/web/lib/splash.ts
 * Copyright (c) 2026 Clove Nytrix Doughmination Twilight
 * Licensed under the DASL-1.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

// Long enough for the intro in index.html to play through once.
const introMs = 1150;
// A slow connection gets the app (and its spinner) after this long.
const maxMs = 4000;

// The installed app (PWA or the Android TWA) always plays the intro.
const installed =
  matchMedia("(display-mode: standalone)").matches ||
  document.referrer.startsWith("android-app://");

let hidden = false;

/** Lifts the splash away once mail is in. In a browser tab, right away. */
export function hideSplash() {
  if (hidden) return;
  hidden = true;
  const splash = document.getElementById("splash");
  if (!splash) return;

  const wait = installed ? Math.max(0, introMs - performance.now()) : 0;
  setTimeout(() => {
    splash.classList.add("out");
    setTimeout(() => splash.remove(), 450);
  }, wait);
}

setTimeout(hideSplash, maxMs);
