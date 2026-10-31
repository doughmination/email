import { Hono } from "hono";
import type { AppEnv } from "../middleware";

/** The rolling release CI keeps the newest Android build on. */
const LATEST = "https://api.github.com/repos/doughmination/email/releases/tags/latest";
const RELEASES = "https://github.com/doughmination/email/releases/latest";

// Release APKs are named by version (inbox-1.0.6.apk), so /download looks up
// the current one: the site's link stays the same from build to build.
export const download = new Hono<AppEnv>().get("/", async (c) => {
  const res = await fetch(LATEST, {
    headers: { accept: "application/vnd.github+json", "user-agent": "doughmination-mail" },
    // Cached at the edge, so a busy day doesn't run into GitHub's rate limit.
    cf: { cacheTtl: 300, cacheEverything: true },
  });
  if (!res.ok) return c.redirect(RELEASES);
  const { assets } = (await res.json()) as { assets: { name: string; browser_download_url: string }[] };
  const apk = assets.find((a) => /^inbox-.+\.apk$/.test(a.name));
  return c.redirect(apk?.browser_download_url ?? RELEASES);
});
