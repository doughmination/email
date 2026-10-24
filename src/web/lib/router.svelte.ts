import type { ListFolder } from "../../shared/types";

export type Route =
  | { name: "folder"; folder: ListFolder; threadId: string | null }
  | { name: "settings" }
  | { name: "admin" };

/**
 * The demo runs the same app under /demo, against the in-memory fake in
 * demo.ts. Routes and links are written without this prefix; the router adds
 * and strips it.
 */
export const base = /^\/demo(\/|$)/.test(location.pathname) ? "/demo" : "";
export const isDemo = base !== "";

function strip(pathname: string): string {
  return pathname.slice(base.length) || "/";
}

function parse(path: string): Route {
  const [first, second] = path.split("/").filter(Boolean);
  if (first === "settings") return { name: "settings" };
  if (first === "admin") return { name: "admin" };
  const folder: ListFolder = first === "sent" || first === "drafts" || first === "bin" ? first : "inbox";
  return { name: "folder", folder, threadId: second ?? null };
}

class Router {
  path = $state(strip(location.pathname));
  search = $state(location.search);
  route = $derived(parse(this.path));
  /** ?in=addr@domain for one address, ?in=@domain for a whole domain. */
  mailbox = $derived(new URLSearchParams(this.search).get("in"));

  constructor() {
    addEventListener("popstate", () => this.sync());
  }

  private sync() {
    this.path = strip(location.pathname);
    this.search = location.search;
  }

  /** An app path as a real URL, for href attributes. */
  href(url: string): string {
    return base + url;
  }

  go(url: string, { replace = false } = {}) {
    if (base + url === location.pathname + location.search) return;
    history[replace ? "replaceState" : "pushState"](null, "", base + url);
    this.sync();
  }

  /** Same folder and mailbox filter, different thread (or none). */
  thread(id: string | null) {
    const r = this.route;
    const folder = r.name === "folder" ? r.folder : "inbox";
    this.go(`/${folder}${id ? `/${id}` : ""}${this.search}`);
  }
}

export const router = new Router();

/** Lets plain <a href="/..."> links navigate without a page load. */
export function interceptLinks(root: HTMLElement) {
  root.addEventListener("click", (ev) => {
    if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    const a = (ev.target as Element).closest("a");
    if (!a || a.target || a.hasAttribute("download") || a.origin !== location.origin) return;
    if (a.pathname.startsWith("/api/") || a.pathname.startsWith("/auth/")) return;
    if (base && !a.pathname.startsWith(base)) return;
    ev.preventDefault();
    router.go(strip(a.pathname) + a.search);
  });
}
