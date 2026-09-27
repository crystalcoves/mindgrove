import { parentKey } from "./tree";
import type { Limb, Link, Snapshot, Thought } from "./types";

/*
 * Tidy-up for data that arrived twice (e.g. two devices that each created the
 * starter tree before syncing). Deterministic — every device picks the same
 * survivor (lowest id) — so synced devices converge instead of fighting.
 * Conservative: limbs merge only on the same name; thoughts merge only when
 * they share a parent, title AND notes.
 */

export const REFLECTION_LIMB_ID = "limb-reflection";
const RENAMES: Record<string, string> = { "getting started": "General" };

export interface TidyResult {
  thoughts: Thought[]; // changed or kept thoughts to write
  limbs: Limb[]; // changed limbs to write
  links: Link[]; // changed links to write
  removed: string[]; // ids (thoughts, limbs, links) to delete + tombstone
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

export function tidySnapshot(s: Snapshot, now = Date.now()): TidyResult {
  const thoughts = new Map(s.thoughts.map((t) => [t.id, { ...t }]));
  const limbs = new Map(s.limbs.map((l) => [l.id, { ...l }]));
  const changedT = new Set<string>();
  const changedL = new Set<string>();
  const removed = new Set<string>();
  const survivor = new Map<string, string>(); // merged thought id → the one kept

  // 1. Renames (e.g. "Getting started" → "General").
  for (const l of limbs.values()) {
    const to = RENAMES[norm(l.name)];
    if (to && l.name !== to) {
      l.name = to;
      l.updatedAt = now;
      changedL.add(l.id);
    }
  }

  // 2. Limbs with the same name → keep the lowest id, move branches over.
  const byName = new Map<string, Limb[]>();
  for (const l of limbs.values()) byName.set(norm(l.name), [...(byName.get(norm(l.name)) ?? []), l]);
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => (a.id < b.id ? -1 : 1));
    const keep = group[0];
    for (const dup of group.slice(1)) {
      for (const t of thoughts.values())
        if (t.limbId === dup.id) {
          t.limbId = keep.id;
          t.updatedAt = now;
          changedT.add(t.id);
        }
      limbs.delete(dup.id);
      removed.add(dup.id);
    }
  }

  // 3. Identical sibling thoughts → keep the lowest id; its twin's follow-ups
  //    move under it (which may reveal more twins, so repeat until stable).
  for (let pass = 0; pass < 20; pass++) {
    const groups = new Map<string, Thought[]>();
    for (const t of thoughts.values()) {
      const key = `${parentKey(t)}\u0000${norm(t.title)}\u0000${t.body.trim()}`;
      groups.set(key, [...(groups.get(key) ?? []), t]);
    }
    let merged = false;
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      group.sort((a, b) => (a.id < b.id ? -1 : 1));
      const keep = group[0];
      for (const dup of group.slice(1)) {
        for (const t of thoughts.values())
          if (t.parentId === dup.id) {
            t.parentId = keep.id;
            t.updatedAt = now;
            changedT.add(t.id);
          }
        // Keep the most advanced status and all tags.
        const tags = [...new Set([...keep.tags, ...dup.tags])];
        if (tags.length !== keep.tags.length) {
          keep.tags = tags;
          keep.updatedAt = now;
          changedT.add(keep.id);
        }
        thoughts.delete(dup.id);
        removed.add(dup.id);
        survivor.set(dup.id, keep.id);
        changedT.delete(dup.id);
        merged = true;
      }
    }
    if (!merged) break;
  }

  // 4. Links follow merged thoughts to their survivor; drop self-links and repeats.
  const resolve = (id: string) => {
    let cur = id;
    for (let n = 0; n < 50 && survivor.has(cur); n++) cur = survivor.get(cur)!;
    return cur;
  };
  const seen = new Set<string>();
  const changedLinks: Link[] = [];
  for (const l of [...s.links].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const from = resolve(l.from);
    const to = resolve(l.to);
    if (!thoughts.has(from) || !thoughts.has(to)) continue; // dangling: sync's merge handles these
    const pair = from < to ? `${from}|${to}` : `${to}|${from}`;
    if (from === to || seen.has(pair)) {
      removed.add(l.id);
      continue;
    }
    seen.add(pair);
    if (from !== l.from || to !== l.to) changedLinks.push({ ...l, from, to, createdAt: now });
  }

  return {
    thoughts: [...changedT].map((id) => thoughts.get(id)!).filter(Boolean),
    limbs: [...changedL].map((id) => limbs.get(id)!).filter(Boolean),
    links: changedLinks,
    removed: [...removed],
  };
}
