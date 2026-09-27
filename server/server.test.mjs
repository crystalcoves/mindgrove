// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, prunable } from "./server.mjs";

let base, server, dir;
const id = "a".repeat(64);

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "mg-"));
  await mkdir(join(dir, "dist", "assets"), { recursive: true });
  await writeFile(join(dir, "dist", "index.html"), "<!doctype html><title>Mindgrove</title>" + " ".repeat(2000));
  await writeFile(join(dir, "dist", "assets", "app-abc.js"), "console.log(1)");
  server = createServer({ distDir: join(dir, "dist"), dataDir: join(dir, "data") });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => {
  server.close();
  await rm(dir, { recursive: true, force: true });
});

const put = (rev, data, who = id) =>
  fetch(`${base}/api/sync/${who}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ rev, data }) });

describe("server", () => {
  it("serves the app shell for routes and share-target URLs, with caching rules", async () => {
    const r = await fetch(`${base}/?title=hi`);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-cache");
    expect(r.headers.get("content-encoding")).toBe("gzip");
    expect(r.headers.get("cross-origin-embedder-policy")).toBe("credentialless");
    expect(await r.text()).toContain("Mindgrove");
    const a = await fetch(`${base}/assets/app-abc.js`);
    expect(a.headers.get("cache-control")).toContain("immutable");
    expect((await fetch(`${base}/assets/missing.js`)).status).toBe(404);
    // Traversal attempts stay inside dist/ (they get the app shell, never a system file).
    const trav = await (await fetch(`${base}/..%2f..%2fetc%2fpasswd`)).text();
    expect(trav).toContain("Mindgrove");
    expect(trav).not.toContain("root:");
  });

  it("stores encrypted blobs with compare-and-swap revisions", async () => {
    expect((await fetch(`${base}/api/sync/${id}`)).status).toBe(404);
    expect(await (await put(0, "cipher-1")).json()).toEqual({ rev: 1 });
    const stale = await put(0, "cipher-x");
    expect(stale.status).toBe(409);
    expect((await stale.json()).data).toBe("cipher-1");
    expect(await (await put(1, "cipher-2")).json()).toEqual({ rev: 2 });
    const got = await (await fetch(`${base}/api/sync/${id}`)).json();
    expect(got).toMatchObject({ rev: 2, data: "cipher-2" });
  });

  it("serializes concurrent writers", async () => {
    const other = "b".repeat(64);
    const results = await Promise.all([put(0, "one", other), put(0, "two", other)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it("rejects bad ids and bodies", async () => {
    expect((await fetch(`${base}/api/sync/nope`)).status).toBe(400);
    expect((await put(-1, "x")).status).toBe(400);
    const bad = await fetch(`${base}/api/sync/${id}`, { method: "PUT", body: "{" });
    expect(bad.status).toBe(400);
  });

  it("keeps a backup snapshot of the blob and serves the history", async () => {
    const who = "c".repeat(64);
    await put(0, "first", who);
    await put(1, "second", who); // within 6 hours of the first: no new snapshot
    const list = await (await fetch(`${base}/api/sync/${who}/history`)).json();
    expect(list.items).toHaveLength(1);
    const snap = await (await fetch(`${base}/api/sync/${who}/history/${list.items[0].at}`)).json();
    expect(snap).toMatchObject({ rev: 1, data: "first" });
    expect((await fetch(`${base}/api/sync/${who}/history/123`)).status).toBe(404);
    expect((await fetch(`${base}/api/sync/${who}/history/..%2f..`)).status).toBe(400);
    expect((await fetch(`${base}/api/sync/${"d".repeat(64)}/history`).then((r) => r.json())).items).toEqual([]);
  });

  it("sends a share-target POST without a service worker back to the app", async () => {
    const r = await fetch(`${base}/share-target`, { method: "POST", body: "x", redirect: "manual" });
    expect(r.status).toBe(303);
  });
});

describe("history pruning", () => {
  const H = 3600_000;
  const D = 24 * H;
  const now = 100 * D + 12 * H;
  it("keeps the last two days, then the newest per day, for 30 days", () => {
    const recent = [now - H, now - 7 * H, now - 30 * H];
    const olderSameDay = [now - 5 * D, now - 5 * D - H];
    const ancient = [now - 31 * D];
    const drop = prunable([...recent, ...olderSameDay, ...ancient], now);
    expect(drop.sort()).toEqual([now - 31 * D, now - 5 * D - H].sort());
  });
});
