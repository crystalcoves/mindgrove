/*
 * End-to-end encryption for sync. The sync code never leaves the device:
 * the server only sees an id derived from it and AES-GCM ciphertext.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

// No 0/1/i/l/o, so codes survive being read aloud or retyped.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const CODE_LEN = 28; // ~138 bits

function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** A new random sync code, shown as 7 groups of 4, e.g. "k3fq-9xtz-…". */
export function newSyncCode(): string {
  let out = "";
  while (out.length < CODE_LEN) {
    for (const b of crypto.getRandomValues(new Uint8Array(32))) {
      if (b < 248 && out.length < CODE_LEN) out += ALPHABET[b % ALPHABET.length]; // 248 = 8 × 31, unbiased
    }
  }
  return out.match(/.{4}/g)!.join("-");
}

/** Codes compare case-insensitively, ignoring dashes and spaces. */
export const normalizeCode = (code: string) => code.toLowerCase().replace(/[\s-]/g, "");

export function isValidCode(code: string): boolean {
  return new RegExp(`^[${ALPHABET}]{${CODE_LEN}}$`).test(normalizeCode(code));
}

export const formatCode = (code: string) =>
  normalizeCode(code)
    .match(/.{1,4}/g)
    ?.join("-") ?? "";

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

export interface SyncKeys {
  id: string;
  key: CryptoKey;
}

export async function deriveKeys(code: string): Promise<SyncKeys> {
  const c = normalizeCode(code);
  const idBytes = await sha256(`mindgrove:id:${c}`);
  const id = [...idBytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  const raw = await sha256(`mindgrove:key:${c}`);
  const key = await crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
  return { id, key };
}

export async function encryptJSON(key: CryptoKey, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(value))));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return toB64(out);
}

export async function decryptJSON<T>(key: CryptoKey, data: string): Promise<T> {
  const bytes = fromB64(data);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, key, bytes.slice(12));
  return JSON.parse(dec.decode(pt)) as T;
}
