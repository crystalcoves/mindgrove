import { loadAll } from "../db/db";
import { setChangeHook } from "../db/notify";
import { useStore } from "../store/store";
import { docSignature, mergeDocs, type SyncDoc } from "./merge";

/*
 * Keep every open copy of the app in step with the on-device database.
 * A share, a second window or the installed PWA each run their own copy;
 * after any write we ping the others, and they merge what's stored (same
 * last-writer-wins rules as sync, so nothing typed in the meantime is lost).
 * Also refresh whenever the app comes back to the foreground.
 */

const channel: BroadcastChannel | null = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("mindgrove") : null;
let timer: ReturnType<typeof setTimeout> | null = null;
let refreshing = false;
let again = false;

/** Tell other open copies that the database changed (debounced). */
export function notifyChange() {
  if (!channel) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => channel.postMessage("changed"), 120);
}

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

export async function refreshFromDb() {
  if (!useStore.getState().ready) return;
  if (refreshing) {
    again = true; // a change landed mid-refresh; look again once this one finishes
    return;
  }
  refreshing = true;
  try {
    const d = await loadAll();
    const stored: SyncDoc = { v: 1, thoughts: d.thoughts, limbs: d.limbs, links: d.links, tombstones: d.tombstones };
    const local = localDoc();
    const merged = mergeDocs(local, stored);
    if (docSignature(merged) !== docSignature(local)) useStore.getState().absorb(merged);
  } finally {
    refreshing = false;
    if (again) {
      again = false;
      void refreshFromDb();
    }
  }
}

export function watchOtherTabs() {
  setChangeHook(notifyChange);
  channel?.addEventListener("message", (e) => e.data === "changed" && void refreshFromDb());
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && void refreshFromDb());
  addEventListener("focus", () => void refreshFromDb());
}
