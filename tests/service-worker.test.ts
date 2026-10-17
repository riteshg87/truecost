import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

class FakeResponse {
  ok: boolean;
  body: string;
  constructor(body: string, ok = true) { this.body = body; this.ok = ok; }
  clone() { return new FakeResponse(this.body, this.ok); }
  static error() { return new FakeResponse("", false); }
}

class FakeCache {
  entries = new Map<string, FakeResponse>();
  failAdd = false;
  async addAll(paths: string[]) {
    for (const path of paths) {
      if (this.failAdd && path.includes("calculator")) throw new Error("precache failed");
      this.entries.set(path, new FakeResponse(path));
    }
  }
  async put(request: { url: string }, response: FakeResponse) { this.entries.set(new URL(request.url).pathname, response); }
  async match(request: { url: string } | string) { return this.entries.get(typeof request === "string" ? request : new URL(request.url).pathname); }
}

async function harness() {
  const code = await readFile("public/sw.js", "utf8");
  const listeners = new Map<string, (event: any) => void>();
  const cacheMap = new Map<string, FakeCache>();
  let networkDown = false;
  const caches = {
    open: async (name: string) => { let cache = cacheMap.get(name); if (!cache) { cache = new FakeCache(); cacheMap.set(name, cache); } return cache; },
    keys: async () => [...cacheMap.keys()],
    delete: async (name: string) => cacheMap.delete(name),
    match: async (request: any) => { for (const cache of cacheMap.values()) { const hit = await cache.match(request); if (hit) return hit; } return undefined; },
  };
  const scope: any = {
    location: { origin: "https://truecost.test" },
    caches,
    Response: FakeResponse,
    URL,
    skipWaiting: async () => undefined,
    clients: { claim: async () => undefined },
    addEventListener: (type: string, handler: (event: any) => void) => listeners.set(type, handler),
  };
  const context: any = { self: scope, caches, URL, Response: FakeResponse, console };
  context.fetch = async (request: any) => { if (networkDown) throw new Error("offline"); return new FakeResponse(request.url); };
  vm.runInNewContext(code, context);
  const dispatch = async (type: string, event: any) => { let promise: Promise<any> | undefined; event.responded = false; event.waitUntil = (p: Promise<any>) => { promise = p; }; event.respondWith = (p: Promise<any>) => { event.responded = true; promise = p; }; listeners.get(type)?.(event); return promise; };
  return { cacheMap, caches, scope, dispatch, setNetworkDown: (value: boolean) => { networkDown = value; } };
}

const request = (url: string, init: Partial<{ method: string; mode: string; headers: Record<string, string> }> = {}) => ({ url: `https://truecost.test${url}`, method: init.method ?? "GET", mode: init.mode ?? "same-origin", headers: { get: (name: string) => init.headers?.[name] ?? null } });

describe("generated public service worker", () => {
  it("fails when generated hashes or links no longer match source", async () => {
    const manifest = JSON.parse(await readFile("public/offline/manifest.json", "utf8"));
    const css = await readFile("offline/styles.css");
    const template = await readFile("offline/index.template.html", "utf8");
    const swTemplate = await readFile("offline/sw-template.js", "utf8");
    const result = await build({ absWorkingDir: process.cwd(), entryPoints: ["offline/main.ts"], bundle: true, format: "iife", platform: "browser", target: "es2020", minify: true, write: false, legalComments: "none" });
    const js = result.outputFiles[0]!.contents;
    const shortHash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    expect(manifest.assets).toContain(`/offline/assets/calculator.${shortHash(css)}.css`);
    expect(manifest.assets).toContain(`/offline/assets/calculator.${shortHash(js)}.js`);
    const html = await readFile("public/offline/index.html", "utf8");
    expect(html).toContain(`/offline/assets/calculator.${shortHash(css)}.css`);
    expect(html).toContain(`/offline/assets/calculator.${shortHash(js)}.js`);
    const expectedHtml = template.replace("__CSS__", `/offline/assets/calculator.${shortHash(css)}.css`).replace("__JS__", `/offline/assets/calculator.${shortHash(js)}.js`);
    const expectedVersion = shortHash(Buffer.concat([Buffer.from(expectedHtml), Buffer.from(js), css, Buffer.from(swTemplate)]));
    expect(manifest.version).toBe(expectedVersion);
    expect(await readFile("public/sw.js", "utf8")).toBe(swTemplate.replace("__VERSION__", expectedVersion).replace("__ASSETS__", JSON.stringify(manifest.assets)).trimEnd() + "\n");
  });

  it("precaches exactly the generated public manifest", async () => {
    const h = await harness();
    await h.dispatch("install", {});
    const cache = [...h.cacheMap.values()][0]!;
    const manifest = JSON.parse(await readFile("public/offline/manifest.json", "utf8"));
    expect([...cache.entries.keys()]).toEqual(manifest.assets);
    expect((await readFile("public/sw.js", "utf8"))).toContain(JSON.stringify(manifest.assets));
  });

  it("falls back to the labelled offline calculator and never caches private requests", async () => {
    const h = await harness();
    const unrelated = await h.caches.open("unrelated-cache");
    unrelated.entries.set("/offline/index.html", new FakeResponse("UNRELATED-CACHE-CANARY"));
    await h.dispatch("install", {});
    h.setNetworkDown(true);
    const offline = await h.dispatch("fetch", { request: request("/account", { mode: "navigate" }) });
    expect((offline as FakeResponse).body).toBe("/offline/index.html");
    const privateEvent: any = { request: request("/api/private-export") };
    expect(await h.dispatch("fetch", privateEvent)).toBeUndefined();
    const rscEvent: any = { request: request("/compare/results?_rsc=synthetic", { headers: { RSC: "1" } }) };
    expect(await h.dispatch("fetch", rscEvent)).toBeUndefined();
  });

  it("does not cache normal navigation, query strings, cross-origin or unrelated caches", async () => {
    const h = await harness();
    await h.dispatch("install", {});
    h.cacheMap.set("truecost-v2", new FakeCache());
    h.cacheMap.set("unrelated-cache", new FakeCache());
    await h.dispatch("activate", {});
    expect(h.cacheMap.has("truecost-v2")).toBe(false);
    expect(h.cacheMap.has("unrelated-cache")).toBe(true);
    const normal: any = { request: request("/compare", { mode: "navigate" }) };
    await h.dispatch("fetch", normal);
    expect(normal.responded).toBe(true);
    expect([...([...h.cacheMap.values()][0]!.entries.keys())]).not.toContain("/compare");
    const query: any = { request: request("/offline/index.html?x=1") };
    await h.dispatch("fetch", query);
    expect(query.responded).toBe(false);
  });

  it("keeps the previous version usable when precache fails", async () => {
    const h = await harness();
    h.cacheMap.set("truecost-offline-old", new FakeCache());
    const current = await h.caches.open("truecost-offline-old");
    current.entries.set("/offline/index.html", new FakeResponse("old"));
    const originalOpen = h.caches.open;
    h.caches.open = async (name: string) => { const cache = await originalOpen(name); if (name.startsWith("truecost-offline-") && name !== "truecost-offline-old") cache.failAdd = true; return cache; };
    await expect(h.dispatch("install", {})).rejects.toThrow("precache failed");
    expect(h.cacheMap.has("truecost-offline-old")).toBe(true);
  });
});
