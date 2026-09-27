import { create } from "zustand";
import { db, persist } from "../db/db";
import { useStore } from "../store/store";
import { decryptJSON, deriveKeys, encryptJSON, formatCode, isValidCode, newSyncCode, type SyncKeys } from "./crypto";
import { docSignature, emptyDoc, mergeDocs, type SyncDoc } from "./merge";

/*
 * Sync engine. Pull → merge → apply locally → push with compare-and-swap on
 * the server revision; on a conflict, pull again. Runs a few seconds after
 * edits, when the tab regains focus or comes back online, and once a minute.
 */

export type SyncStatus = "off" | "syncing" | "synced" | "offline" | "error";

interface SyncState {
  status: SyncStatus;
  code: string | null;
  lastSync: number;
  error: string | null;
}

export const useSync = create<SyncState>(() => ({ status: "off", code: null, lastSync: 0, error: null }));

const API = `${import.meta.env.BASE_URL}api/sync/`;
const EDIT_DELAY = 2500;
const POLL = 60_000;

let keys: SyncKeys | null = null;
let running = false;
let again = false;
let applying = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let unsub: (() => void) | null = null;
let poll: ReturnType<typeof setInterval> | null = null;

function localDoc(): SyncDoc {
  const s = useStore.getState();
  return {
    v: 1,
    thoughts: Object.values(s.thoughts),
    limbs: Object.values(s.limbs),
    links: Object.values(s.links),
    tombstones: s.tombstones,
  };
}

export function scheduleSync(delay = EDIT_DELAY) {
  if (!keys) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), delay);
}

export async function syncNow(): Promise<void> {
  if (!keys) return;
  if (running) {
    again = true;
    return;
  }
  running = true;
  const k = keys;
  useSync.setState({ status: "syncing", error: null });
  try {
    for (let attempt = 0; ; attempt++) {
      if (attempt > 4) throw new Error("Too many conflicting edits — will retry");
      const r = await fetch(API + k.id, { cache: "no-store" });
      let remote = emptyDoc();
      let rev = 0;
      if (r.status === 200) {
        const body = (await r.json()) as { rev: number; data: string };
        remote = await decryptJSON<SyncDoc>(k.key, body.data).catch(() => {
          throw new Error("Couldn't decrypt the synced grove — check the sync code");
        });
        rev = body.rev;
      } else if (r.status !== 404) throw new Error(`Server said ${r.status}`);
      if (keys !== k) return; // sync was turned off or switched meanwhile

      const local = localDoc();
      const merged = mergeDocs(local, remote);
      const sig = docSignature(merged);
      if (sig !== docSignature(local)) {
        applying = true;
        try {
          useStore.getState().applySync(merged);
        } finally {
          applying = false;
        }
        // Another device may have brought duplicates (e.g. its own starter tree);
        // merging them changes data, which schedules the next push.
        useStore.getState().tidyUp();
      }
      if (r.status === 200 && sig === docSignature(remote)) break; // server already has it all

      const put = await fetch(API + k.id, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rev, data: await encryptJSON(k.key, merged) }),
      });
      if (put.status === 409) continue;
      if (!put.ok) throw new Error(put.status === 413 ? "Your grove is too big to sync (8 MB limit)" : `Server said ${put.status}`);
      break;
    }
    useSync.setState({ status: "synced", lastSync: Date.now() });
  } catch (e) {
    const offline = e instanceof TypeError || (typeof navigator !== "undefined" && !navigator.onLine);
    useSync.setState({ status: offline ? "offline" : "error", error: offline ? null : (e as Error).message });
  } finally {
    running = false;
    if (again) {
      again = false;
      scheduleSync(300);
    }
  }
}

async function activate(code: string) {
  keys = await deriveKeys(code);
  useSync.setState({ code: formatCode(code), status: "syncing" });
  unsub?.();
  unsub = useStore.subscribe((s, p) => {
    if (applying) return;
    if (s.thoughts !== p.thoughts || s.limbs !== p.limbs || s.links !== p.links || s.tombstones !== p.tombstones) scheduleSync();
  });
  if (!poll) {
    poll = setInterval(() => document.visibilityState === "visible" && scheduleSync(0), POLL);
    addEventListener("online", () => scheduleSync(0));
    addEventListener("focus", () => scheduleSync(0));
    document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && scheduleSync(0));
  }
  await syncNow();
}

/** Resume sync on startup if this device has a code. */
export async function bootSync() {
  const saved = (await db.kv.get("sync"))?.value as { code?: string } | undefined;
  if (saved?.code && isValidCode(saved.code)) await activate(saved.code);
}

/** Turn sync on: with a fresh code (first device) or an existing one (joining). */
export async function enableSync(code?: string): Promise<string> {
  const c = code ?? newSyncCode();
  if (!isValidCode(c)) throw new Error("That doesn't look like a Mindgrove sync code");
  await persist.setKV("sync", { code: formatCode(c) });
  await activate(c);
  return formatCode(c);
}

/** Stop syncing on this device. Local data stays; the server copy stays for other devices. */
export async function disableSync() {
  keys = null;
  unsub?.();
  unsub = null;
  if (timer) clearTimeout(timer);
  await persist.setKV("sync", null);
  useSync.setState({ status: "off", code: null, error: null });
}
