import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { enabledDomains } from "../src/worker/services/directory";
import { listDomains, syncDomains } from "../src/worker/services/domains";

type FakeDomain = { name: string; receiving?: boolean; sending?: boolean };

/** Answers Resend's GET /domains with `domains`, split into pages of `pageSize`. */
function fakeResend(domains: FakeDomain[], pageSize = 100) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (!url.pathname.endsWith("/domains")) throw new Error(`unexpected request to ${url}`);
    const after = url.searchParams.get("after");
    const start = after ? domains.findIndex((d) => d.name === after) + 1 : 0;
    const page = domains.slice(start, start + pageSize);
    return Response.json({
      object: "list",
      has_more: start + pageSize < domains.length,
      data: page.map((d) => ({
        id: d.name,
        name: d.name,
        status: "verified",
        created_at: "2026-10-01T00:00:00Z",
        region: "eu-west-1",
        capabilities: {
          receiving: d.receiving === false ? "disabled" : "enabled",
          sending: d.sending === false ? "disabled" : "enabled",
        },
      })),
    });
  });
}

afterEach(() => vi.restoreAllMocks());

describe("syncDomains", () => {
  it("switches new Resend domains on, following every page", async () => {
    fakeResend([{ name: "a.test" }, { name: "b.test" }, { name: "c.test", receiving: false }], 2);
    expect(await syncDomains(env)).toEqual({ count: 3 });
    // c.test has receiving off in Resend, so it doesn't route.
    expect(await enabledDomains(env)).toEqual(["a.test", "b.test"]);
  });

  it("keeps an admin's switch and catch-all across syncs", async () => {
    await env.DB.prepare("UPDATE domains SET enabled = 0 WHERE name = 'b.test'").run();
    fakeResend([{ name: "a.test" }, { name: "b.test" }]);
    await syncDomains(env);
    expect(await enabledDomains(env)).toEqual(["a.test"]);
  });

  it("stops routing a domain that's gone from Resend, but keeps its row", async () => {
    fakeResend([{ name: "b.test" }]);
    await syncDomains(env);
    expect(await enabledDomains(env)).toEqual([]);
    const a = (await listDomains(env)).find((d) => d.name === "a.test");
    expect(a).toMatchObject({ enabled: true, active: false, resend: null });
  });

  it("changes nothing when Resend can't be reached", async () => {
    fakeResend([{ name: "a.test" }]);
    await syncDomains(env);
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ message: "down" }, { status: 500 }));
    await expect(syncDomains(env)).rejects.toThrow();
    expect(await enabledDomains(env)).toEqual(["a.test"]);
  });
});
