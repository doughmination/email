import { describe, expect, it } from "vitest";
import { baseSubject, isReplySubject } from "../src/worker/lib/address";
import { addressesOf, buildDirectory, route } from "../src/worker/lib/routing";

const dir = buildDirectory(
  [
    { name: "doughmination.gay", catch_all: "clove" },
    { name: "doughmination.win", catch_all: null },
  ],
  [
    { local_part: "admin", domain: "", username: "clove" },
    { local_part: "ctf", domain: "doughmination.gay", username: "clove" },
    { local_part: "ari", domain: "doughmination.win", username: "clove" },
  ],
);
const users = new Set(["clove", "ari", "admin"]);
const isUser = (l: string) => users.has(l);

describe("route", () => {
  it("gives every user their name on every enabled domain", () => {
    expect(route(dir, "ari@doughmination.gay", isUser)).toEqual({ kind: "user", owner: "ari" });
    expect(route(dir, "Clove <CLOVE@doughmination.win>", isUser)).toEqual({ kind: "user", owner: "clove" });
  });

  it("lets an alias win over a username of the same name", () => {
    expect(route(dir, "admin@doughmination.win", isUser)).toEqual({ kind: "alias", owner: "clove" });
    expect(route(dir, "ari@doughmination.win", isUser)).toEqual({ kind: "alias", owner: "clove" });
  });

  it("scopes a domain-specific alias to that domain", () => {
    expect(route(dir, "ctf@doughmination.gay", isUser).kind).toBe("alias");
    expect(route(dir, "ctf@doughmination.win", isUser)).toEqual({ kind: "none" });
  });

  it("falls back to the catch-all, or nowhere", () => {
    expect(route(dir, "nobody@doughmination.gay", isUser)).toEqual({ kind: "catch-all", owner: "clove" });
    expect(route(dir, "nobody@doughmination.win", isUser)).toEqual({ kind: "none" });
  });

  it("ignores domains that aren't enabled", () => {
    expect(route(dir, "clove@example.com", isUser)).toEqual({ kind: "none" });
  });
});

describe("addressesOf", () => {
  it("is exactly the addresses whose mail reaches the user", () => {
    expect(addressesOf(dir, "clove")).toEqual([
      "admin@doughmination.gay",
      "admin@doughmination.win",
      "ari@doughmination.win",
      "clove@doughmination.gay",
      "clove@doughmination.win",
      "ctf@doughmination.gay",
    ]);
  });

  it("drops a username address an alias has taken", () => {
    expect(addressesOf(dir, "ari")).toEqual(["ari@doughmination.gay"]);
    expect(addressesOf(dir, "admin")).toEqual([]);
  });

  it("never lets the catch-all owner send as unknown addresses", () => {
    expect(addressesOf(dir, "clove")).not.toContain("nobody@doughmination.gay");
  });
});

describe("subjects", () => {
  it("strips stacked reply prefixes", () => {
    expect(baseSubject("Re: Fwd: RE[2]: Hello")).toBe("hello");
    expect(isReplySubject("AW: Hallo")).toBe(true);
    expect(isReplySubject("Rendezvous")).toBe(false);
  });
});
