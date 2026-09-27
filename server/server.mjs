// Mindgrove server: serves the built PWA and stores end-to-end encrypted sync
// blobs. No dependencies. The server never sees plaintext: clients send an id
// derived from their sync code plus AES-GCM ciphertext.
import { createServer as httpServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const MAX_BODY = 8 * 1024 * 1024;
const ID_RE = /^[0-9a-f]{64}$/;
const RATE = { windowMs: 60_000, max: 120 };
const HOUR = 3600_000;
const DAY = 24 * HOUR;
// Backup history: a snapshot at most every 6 hours; everything from the last
// two days is kept, then one per day, for 30 days.
export const HISTORY = { every: 6 * HOUR, keepAll: 2 * DAY, maxAge: 30 * DAY };

/** Which snapshot times (ms) to delete: older than 30 days, or not the newest of its day once past 2 days. */
export function prunable(times, now = Date.now()) {
  const drop = [];
  const days = new Set();
  for (const at of [...times].sort((a, b) => b - a)) {
    const age = now - at;
    const day = Math.floor(at / DAY);
    if (age > HISTORY.maxAge) drop.push(at);
    else if (age > HISTORY.keepAll && days.has(day)) drop.push(at);
    days.add(day);
  }
  return drop;
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};
const COMPRESSIBLE = new Set([".html", ".js", ".css", ".json", ".webmanifest", ".svg", ".txt"]);

export function createServer({ distDir, dataDir }) {
  const root = resolve(distDir);
  const syncDir = join(resolve(dataDir), "sync");
  const gzCache = new Map();
  const hits = new Map();
  const locks = new Map();

  const send = (res, code, body, headers = {}) => {
    const data = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    res.writeHead(code, {
      "Content-Type": typeof body === "object" && !Buffer.isBuffer(body) ? "application/json" : "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    });
    res.end(data);
  };

  const limited = (req) => {
    const ip = req.headers["fly-client-ip"] || req.socket.remoteAddress || "?";
    const now = Date.now();
    const h = hits.get(ip);
    if (!h || now - h.at > RATE.windowMs) {
      hits.set(ip, { at: now, n: 1 });
      if (hits.size > 5000) for (const [k, v] of hits) if (now - v.at > RATE.windowMs) hits.delete(k);
      return false;
    }
    return ++h.n > RATE.max;
  };

  const readBody = (req) =>
    new Promise((ok, fail) => {
      const chunks = [];
      let size = 0;
      req.on("data", (c) => {
        size += c.length;
        if (size > MAX_BODY) {
          fail(Object.assign(new Error("too large"), { status: 413 }));
          req.destroy();
        } else chunks.push(c);
      });
      req.on("end", () => ok(Buffer.concat(chunks).toString("utf8")));
      req.on("error", fail);
    });

  const historyRoot = join(resolve(dataDir), "history");
  const file = (id) => join(syncDir, `${id}.json`);
  const historyDir = (id) => join(historyRoot, id);
  const snapshots = async (id) =>
    (await readdir(historyDir(id)).catch(() => []))
      .map((f) => /^(\d+)\.json$/.exec(f)?.[1])
      .filter(Boolean)
      .map(Number)
      .sort((a, b) => b - a);

  // Keep a copy of the (still encrypted) blob now and then, so a bad edit or
  // deletion can be rolled back. Never fails the write it follows.
  const snapshot = async (id, doc) => {
    try {
      const times = await snapshots(id);
      const now = Date.now();
      if (times.length && now - times[0] < HISTORY.every) return;
      await mkdir(historyDir(id), { recursive: true });
      await writeFile(join(historyDir(id), `${now}.json`), JSON.stringify(doc));
      for (const at of prunable([now, ...times], now)) await unlink(join(historyDir(id), `${at}.json`)).catch(() => {});
    } catch (e) {
      console.error("history snapshot failed", e);
    }
  };

  async function history(req, res, id, at) {
    if (!ID_RE.test(id)) return send(res, 400, { error: "bad id" });
    if (req.method !== "GET") return send(res, 405, { error: "method" }, { Allow: "GET" });
    if (at === undefined) {
      const items = [];
      for (const t of await snapshots(id)) {
        const info = await stat(join(historyDir(id), `${t}.json`)).catch(() => null);
        if (info) items.push({ at: t, size: info.size });
      }
      return send(res, 200, { items });
    }
    if (!/^\d{1,16}$/.test(at)) return send(res, 400, { error: "bad time" });
    try {
      return send(res, 200, JSON.parse(await readFile(join(historyDir(id), `${at}.json`), "utf8")));
    } catch (e) {
      if (e.code === "ENOENT") return send(res, 404, { error: "not found" });
      throw e;
    }
  }
  const load = async (id) => {
    try {
      return JSON.parse(await readFile(file(id), "utf8"));
    } catch (e) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
  };
  // Serialize writes per id so compare-and-swap is atomic.
  const withLock = (id, fn) => {
    const prev = locks.get(id) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    locks.set(
      id,
      next.catch(() => {}),
    );
    return next;
  };

  async function sync(req, res, id) {
    if (!ID_RE.test(id)) return send(res, 400, { error: "bad id" });
    if (req.method === "GET") {
      const doc = await load(id);
      return doc ? send(res, 200, doc) : send(res, 404, { error: "not found" });
    }
    if (req.method === "PUT") {
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch (e) {
        return send(res, e.status ?? 400, { error: e.status ? "too large" : "bad json" });
      }
      if (typeof body?.data !== "string" || !Number.isInteger(body?.rev) || body.rev < 0) return send(res, 400, { error: "bad body" });
      return withLock(id, async () => {
        const cur = await load(id);
        const rev = cur?.rev ?? 0;
        if (body.rev !== rev) return send(res, 409, cur ?? { rev: 0 });
        const doc = { rev: rev + 1, data: body.data, updatedAt: Date.now() };
        await mkdir(syncDir, { recursive: true });
        const tmp = `${file(id)}.${process.pid}.${Date.now()}.tmp`;
        await writeFile(tmp, JSON.stringify(doc));
        await rename(tmp, file(id));
        await snapshot(id, doc);
        return send(res, 200, { rev: doc.rev });
      });
    }
    return send(res, 405, { error: "method" }, { Allow: "GET, PUT" });
  }

  async function serveStatic(req, res, pathname) {
    let rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, "");
    let path = resolve(root, rel);
    if (path !== root && !path.startsWith(root + sep)) return send(res, 403, "forbidden");
    let info = await stat(path).catch(() => null);
    if (!info || info.isDirectory()) {
      // App routes (and share-target URLs) all get the app shell.
      if (extname(rel) && !info) return send(res, 404, "not found");
      path = join(root, "index.html");
      rel = "index.html";
      info = await stat(path).catch(() => null);
      if (!info) return send(res, 404, "not built");
    }
    const ext = extname(path);
    const headers = {
      "Content-Type": TYPES[ext] ?? "application/octet-stream",
      // Cross-origin isolation lets in-browser speech-to-text use multiple threads.
      // "credentialless" still allows the CDN/model downloads it needs.
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Cache-Control": rel.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache",
    };
    if (req.method === "HEAD") {
      res.writeHead(200, { ...headers, "Content-Length": info.size });
      return res.end();
    }
    if (COMPRESSIBLE.has(ext) && /\bgzip\b/.test(req.headers["accept-encoding"] ?? "") && info.size > 1024) {
      const key = `${path}:${info.mtimeMs}`;
      let gz = gzCache.get(key);
      if (!gz) {
        gz = gzipSync(await readFile(path));
        gzCache.set(key, gz);
      }
      res.writeHead(200, { ...headers, "Content-Encoding": "gzip", Vary: "Accept-Encoding", "Content-Length": gz.length });
      return res.end(gz);
    }
    res.writeHead(200, { ...headers, "Content-Length": info.size });
    createReadStream(path).pipe(res);
  }

  return httpServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://x");
      if (url.pathname === "/api/health") return send(res, 200, { ok: true });
      if (url.pathname.startsWith("/api/")) {
        if (limited(req)) return send(res, 429, { error: "slow down" }, { "Retry-After": "30" });
        const m = /^\/api\/sync\/([^/]+)$/.exec(url.pathname);
        if (m) return await sync(req, res, m[1]);
        const h = /^\/api\/sync\/([^/]+)\/history(?:\/([^/]+))?$/.exec(url.pathname);
        return h ? await history(req, res, h[1], h[2]) : send(res, 404, { error: "not found" });
      }
      // Shared files are caught by the service worker; if it isn't running yet, just open the app.
      if (req.method === "POST" && url.pathname === "/share-target") {
        req.resume();
        res.writeHead(303, { Location: "/?share=failed" });
        return res.end();
      }
      if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "method");
      return await serveStatic(req, res, url.pathname);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) send(res, 500, { error: "server" });
      else res.end();
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const port = Number(process.env.PORT ?? 8080);
  const distDir = process.env.DIST_DIR ?? join(fileURLToPath(new URL(".", import.meta.url)), "..", "dist");
  const dataDir = process.env.DATA_DIR ?? "./data";
  createServer({ distDir, dataDir }).listen(port, () => console.log(`mindgrove listening on :${port} (data: ${dataDir})`));
}
