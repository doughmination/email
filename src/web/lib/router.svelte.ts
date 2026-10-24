import type { Folder } from "../../shared/types";

export type Route =
  | { name: "folder"; folder: Folder; threadId: string | null }
  | { name: "settings" }
  | { name: "admin" };

function parse(path: string): Route {
  const [first, second] = path.split("/").filter(Boolean);
  if (first === "settings") return { name: "settings" };
  if (first === "admin") return { name: "admin" };
  const folder: Folder = first === "sent" || first === "drafts" ? first : "inbox";
  return { name: "folder", folder, threadId: second ?? null };
}

class Router {
  path = $state(location.pathname);
  search = $state(location.search);
  route = $derived(parse(this.path));
  /** ?in=addr@domain for one address, ?in=@domain for a whole domain. */
  mailbox = $derived(new URLSearchParams(this.search).get("in"));

  constructor() {
    addEventListener("popstate", () => this.sync());
  }

  private sync() {
    this.path = location.pathname;
    this.search = location.search;
  }

  go(url: string, { replace = false } = {}) {
    if (url === location.pathname + location.search) return;
    history[replace ? "replaceState" : "pushState"](null, "", url);
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
    ev.preventDefault();
    router.go(a.pathname + a.search);
  });
}
