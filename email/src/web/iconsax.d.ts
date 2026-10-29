/* src/web/iconsax.d.ts
 * Copyright (c) 2026 Clove Nytrix Doughmination Twilight
 * Licensed under the DASL-1.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

// <iconsax-icon> is registered by `import "iconsax"` in main.ts
declare module "svelte/elements" {
  export interface SvelteHTMLElements {
    "iconsax-icon": HTMLAttributes<HTMLElement> & {
      name: string;
      type?: "bold" | "broken" | "bulk" | "linear" | "outline" | "twotone";
      size?: number | string;
      color?: string;
      pro?: boolean;
    };
  }
}

export {};
