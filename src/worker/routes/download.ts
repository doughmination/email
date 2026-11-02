import { Hono } from "hono";
import type { AppEnv } from "../middleware";

/**
 * Releases holding the newest Android build, in order. The app is built in
 * doughmination/apps, which keeps it on the rolling `inbox-latest` release.
 * Builds up to 1.0.7 came from this repository's own `latest` release, which
 * stays as a fallback until the first signed build from the monorepo exists.
 */
const SOURCES = [
  "https://api.github.com/repos/doughmination/apps/releases/tags/inbox-latest",
  "https://api.github.com/repos/doughmination/email/releases/tags/latest",
];
const RELEASES = "https://github.com/doughmination/apps/releases";

// Release APKs are named by version (inbox-1.0.6.apk), so /download looks up
// the current one: the site's link stays the same from build to build.
export const download = new Hono<AppEnv>().get("/", async (c) => {
  for (const url of SOURCES) {
    const res = await fetch(url, {
      headers: { accept: "application/vnd.github+json", "user-agent": "doughmination-mail" },
      // Cached at the edge, so a busy day doesn't run into GitHub's rate limit.
      cf: { cacheTtl: 300, cacheEverything: true },
    });
    if (!res.ok) continue;
    const { assets } = (await res.json()) as { assets: { name: string; browser_download_url: string }[] };
    const apk = assets.find((a) => /^inbox-.+\.apk$/.test(a.name));
    if (apk) return c.redirect(apk.browser_download_url);
  }
  return c.redirect(RELEASES);
});
