import type { Limb, Link, Snapshot, Thought } from "../model/types";

/*
 * Sync merge: last writer wins per record, plus tombstones so deletions
 * propagate. A record's version is the latest of its timestamps; a tombstone
 * removes any version of the record at or before the time it was deleted.
 */

export type Tombstones = Record<string, number>;

export interface SyncDoc extends Snapshot {
  v: 1;
  tombstones: Tombstones;
}

type Versioned = { id: string; createdAt?: number; updatedAt?: number; touchedAt?: number };

export const versionOf = (r: Versioned) => Math.max(r.updatedAt ?? 0, r.touchedAt ?? 0, r.createdAt ?? 0);

/** Tombstones older than this are forgotten, to keep the document small. */
export const TOMBSTONE_TTL = 180 * 24 * 60 * 60 * 1000;

function mergeRecords<T extends Versioned>(a: T[], b: T[], graves: Tombstones): T[] {
  const out = new Map<string, T>();
  for (const r of [...a, ...b]) {
    const cur = out.get(r.id);
    if (!cur || versionOf(r) > versionOf(cur)) out.set(r.id, r);
  }
  return [...out.values()].filter((r) => !(graves[r.id] !== undefined && graves[r.id] >= versionOf(r)));
}

export function mergeDocs(local: SyncDoc, remote: SyncDoc, now = Date.now()): SyncDoc {
  const tombstones: Tombstones = {};
  for (const g of [local.tombstones, remote.tombstones])
    for (const [id, ts] of Object.entries(g)) if (now - ts < TOMBSTONE_TTL) tombstones[id] = Math.max(tombstones[id] ?? 0, ts);

  const thoughts = mergeRecords<Thought>(local.thoughts, remote.thoughts, tombstones);
  const limbs = mergeRecords<Limb>(local.limbs, remote.limbs, tombstones);
  const ids = new Set(thoughts.map((t) => t.id));
  const limbIds = new Set(limbs.map((l) => l.id));
  const links = mergeRecords<Link>(local.links, remote.links, tombstones).filter((l) => ids.has(l.from) && ids.has(l.to));

  // Repair references to records deleted elsewhere: orphans become roots / seeds.
  const repaired = thoughts.map((t) => {
    let fixed = t;
    if (t.parentId && !ids.has(t.parentId)) fixed = { ...fixed, parentId: null };
    if (fixed.limbId && !limbIds.has(fixed.limbId)) fixed = { ...fixed, limbId: null };
    return fixed;
  });
  // Break any parent cycle created by concurrent moves on two devices.
  const byId = new Map(repaired.map((t) => [t.id, t]));
  for (const t of repaired) {
    const seen = new Set<string>([t.id]);
    let cur = t.parentId;
    while (cur) {
      if (seen.has(cur)) {
        byId.set(t.id, { ...byId.get(t.id)!, parentId: null });
        break;
      }
      seen.add(cur);
      cur = byId.get(cur)?.parentId ?? null;
    }
  }
  return { v: 1, thoughts: [...byId.values()], limbs, links, tombstones };
}

/** Stable fingerprint to tell whether two docs hold the same data. */
export function docSignature(d: SyncDoc): string {
  const part = <T extends Versioned>(rs: T[]) =>
    rs
      .map((r) => `${r.id}@${versionOf(r)}`)
      .sort()
      .join(",");
  const graves = Object.entries(d.tombstones)
    .map(([k, v]) => `${k}@${v}`)
    .sort()
    .join(",");
  return `${part(d.thoughts)}|${part(d.limbs)}|${part(d.links)}|${graves}`;
}

export const emptyDoc = (): SyncDoc => ({ v: 1, thoughts: [], limbs: [], links: [], tombstones: {} });
