import type { Settings, Snapshot } from "../model/types";
import { STATUSES } from "../model/types";
import { exportMarkdown, importMarkdown, type MdFile } from "./markdown";

// ---- JSON backup -----------------------------------------------------------

export interface Backup extends Snapshot {
  app: "mindgrove";
  version: 1;
  exportedAt: string;
  settings?: Partial<Settings>;
}

export function toBackup(s: Snapshot, settings?: Settings): Backup {
  return { app: "mindgrove", version: 1, exportedAt: new Date().toISOString(), settings, ...s };
}

export function parseBackup(text: string): Backup {
  const data = JSON.parse(text) as Partial<Backup>;
  if (data.app !== "mindgrove" || !Array.isArray(data.thoughts) || !Array.isArray(data.limbs) || !Array.isArray(data.links)) {
    throw new Error("Not a Mindgrove backup");
  }
  for (const t of data.thoughts) {
    if (typeof t.id !== "string" || typeof t.title !== "string") throw new Error("Backup has a malformed thought");
    if (!(STATUSES as readonly string[]).includes(t.status)) t.status = "seed";
    t.tags ??= [];
    t.body ??= "";
    t.order ??= 0;
  }
  return data as Backup;
}

// ---- Zip (store-only, no compression; enough for a handful of text files) ---

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zip(files: MdFile[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = enc.encode(f.content);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(local.buffer), name, data);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return concat([...chunks, ...central, new Uint8Array(end.buffer)]);
}

export function unzip(buf: Uint8Array): MdFile[] {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const dec = new TextDecoder();
  const out: MdFile[] = [];
  let p = 0;
  while (p + 30 <= buf.length && view.getUint32(p, true) === 0x04034b50) {
    const flags = view.getUint16(p + 6, true);
    const method = view.getUint16(p + 8, true);
    const size = view.getUint32(p + 18, true);
    const nameLen = view.getUint16(p + 26, true);
    const extraLen = view.getUint16(p + 28, true);
    if (method !== 0 || flags & 0x08) throw new Error("Only Mindgrove-exported (uncompressed) zips can be imported — unzip it and import the .md files instead");
    const name = dec.decode(buf.subarray(p + 30, p + 30 + nameLen));
    const start = p + 30 + nameLen + extraLen;
    if (/\.md$/i.test(name)) out.push({ name: name.split("/").pop()!, content: dec.decode(buf.subarray(start, start + size)) });
    p = start + size;
  }
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// ---- Browser glue ----------------------------------------------------------

export function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

export function downloadMarkdown(s: Snapshot) {
  download(`mindgrove-${stamp()}.zip`, zip(exportMarkdown(s)) as BlobPart, "application/zip");
}

export function downloadBackup(s: Snapshot, settings: Settings) {
  download(`mindgrove-backup-${stamp()}.json`, JSON.stringify(toBackup(s, settings), null, 2), "application/json");
}

/** Read any mix of .json / .zip / .md files into one snapshot. */
export async function readImport(files: File[]): Promise<{ snapshot: Snapshot; kind: "json" | "markdown" }> {
  const json = files.find((f) => /\.json$/i.test(f.name));
  if (json) {
    const b = parseBackup(await json.text());
    return { snapshot: { thoughts: b.thoughts, limbs: b.limbs, links: b.links }, kind: "json" };
  }
  const md: MdFile[] = [];
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) md.push(...unzip(new Uint8Array(await f.arrayBuffer())));
    else if (/\.(md|markdown|txt)$/i.test(f.name)) md.push({ name: f.name, content: await f.text() });
  }
  if (!md.length) throw new Error("Choose a .json backup, a Mindgrove .zip, or .md files");
  return { snapshot: importMarkdown(md), kind: "markdown" };
}
