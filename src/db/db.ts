import Dexie, { type Table } from "dexie";
import type { Limb, Link, Settings, Snapshot, Thought } from "../model/types";
import { notifyChange } from "./notify";

interface KV {
  key: string;
  value: unknown;
}

class GroveDB extends Dexie {
  thoughts!: Table<Thought, string>;
  limbs!: Table<Limb, string>;
  links!: Table<Link, string>;
  kv!: Table<KV, string>;

  constructor(name = "mindgrove") {
    super(name);
    this.version(1).stores({
      thoughts: "id, parentId, limbId, status, updatedAt, *tags",
      limbs: "id, order",
      links: "id, from, to",
      kv: "key",
    });
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
