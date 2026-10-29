import { cloudflare } from "@cloudflare/vite-plugin";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

// One dev server runs both: the Svelte app with HMR, and the Worker in workerd
// with its D1/R2 bindings (local copies under .wrangler/).
export default defineConfig({
  plugins: [svelte(), cloudflare()],
  // iconsax fetches its icon data relative to its own file, which pre-bundling breaks
  optimizeDeps: {
    exclude: ["iconsax"],
  },
});
