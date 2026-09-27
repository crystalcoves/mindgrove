import Dexie, { type Table } from "dexie";
import type { Limb, Link, Settings, Snapshot, Thought } from "../model/types";
import { notifyChange } from "./notify";

/** A voice note's original recording, kept on this device only (never synced). Keyed by the voice-note thought's id. */
export interface VoiceAudio {
  id: string;
  blob: Blob;
  name: string;
  savedAt: number;
}

interface KV {
  key: string;
  value: unknown;
}

class GroveDB extends Dexie {
  thoughts!: Table<Thought, string>;
  limbs!: Table<Limb, string>;
  links!: Table<Link, string>;
  kv!: Table<KV, string>;
  audio!: Table<VoiceAudio, string>;

  constructor(name = "mindgrove") {
    super(name);
    this.version(1).stores({
      thoughts: "id, parentId, limbId, status, updatedAt, *tags",
      limbs: "id, order",
      links: "id, from, to",
      kv: "key",
    });
    this.version(2).stores({ audio: "id" });
  }
}

export const db = new GroveDB();

export async function loadAll(): Promise<
  Snapshot & {
    settings: Partial<Settings> | null;
    seeded: boolean;
    dismissedVines: Record<string, boolean>;
    tombstones: Record<string, number>;
  }
> {
  const [thoughts, limbs, links, settings, seeded, dismissed, tombstones] = await Promise.all([
    db.thoughts.toArray(),
    db.limbs.toArray(),
    db.links.toArray(),
    db.kv.get("settings"),
    db.kv.get("seeded"),
    db.kv.get("dismissedVines"),
    db.kv.get("tombstones"),
  ]);
  return {
    thoughts,
    limbs,
    links,
    settings: (settings?.value as Partial<Settings>) ?? null,
    seeded: !!seeded?.value,
    dismissedVines: (dismissed?.value as Record<string, boolean>) ?? {},
    tombstones: (tombstones?.value as Record<string, number>) ?? {},
  };
}

/** Persistence is write-behind: the store is the source of truth while the app runs. */
export const persist = {
  putThoughts: (ts: Thought[]) => db.thoughts.bulkPut(ts).then(notifyChange, report),
  deleteThoughts: (ids: string[]) => db.thoughts.bulkDelete(ids).then(notifyChange, report),
  putLimbs: (ls: Limb[]) => db.limbs.bulkPut(ls).then(notifyChange, report),
  deleteLimb: (id: string) => db.limbs.delete(id).then(notifyChange, report),
  putLinks: (ls: Link[]) => db.links.bulkPut(ls).then(notifyChange, report),
  deleteLinks: (ids: string[]) => db.links.bulkDelete(ids).then(notifyChange, report),
  setKV: (key: string, value: unknown) => db.kv.put({ key, value }).then(notifyChange, report),
  replaceAll: (s: Snapshot) =>
    db
      .transaction("rw", db.thoughts, db.limbs, db.links, async () => {
        await Promise.all([db.thoughts.clear(), db.limbs.clear(), db.links.clear()]);
        await Promise.all([db.thoughts.bulkPut(s.thoughts), db.limbs.bulkPut(s.limbs), db.links.bulkPut(s.links)]);
      })
      .then(notifyChange, report),
};

function report(err: unknown) {
  console.error("[mindgrove] storage error", err);
}

/* Voice-note audio. Failures only lose playback, never thoughts, so they're quiet. */
export const audioStore = {
  save: (id: string, blob: Blob, name: string) => db.audio.put({ id, blob, name, savedAt: Date.now() }).catch(report),
  get: (id: string) => db.audio.get(id).catch(() => undefined),
  /** Total bytes and count of saved recordings. */
  usage: async () => {
    let bytes = 0;
    let count = 0;
    await db.audio.each((a) => {
      bytes += a.blob.size;
      count++;
    });
    return { bytes, count };
  },
  clear: () => db.audio.clear().catch(report),
  /** Drop recordings whose voice note is gone (the day's grace keeps an undo or another tab safe). */
  prune: async (liveIds: Set<string>) => {
    const dead = (await db.audio.toArray().catch(() => [])).filter((a) => !liveIds.has(a.id) && Date.now() - a.savedAt > 86400e3);
    if (dead.length) await db.audio.bulkDelete(dead.map((a) => a.id)).catch(report);
  },
};
