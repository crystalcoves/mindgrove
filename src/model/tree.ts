import type { Limb, Status, Thought } from "./types";

export const WEEK = 7 * 24 * 60 * 60 * 1000;

export type ById = Record<string, Thought>;

/** Children of each parent key, sorted by order. Key "" holds roots of a limb via `limb:<id>`, seeds via `seeds`. */
export function childrenIndex(thoughts: ById): Map<string, Thought[]> {
  const idx = new Map<string, Thought[]>();
  for (const t of Object.values(thoughts)) {
    const key = parentKey(t);
    let arr = idx.get(key);
    if (!arr) idx.set(key, (arr = []));
    arr.push(t);
  }
  for (const arr of idx.values()) arr.sort(byOrder);
  return idx;
}

export function parentKey(t: Pick<Thought, "parentId" | "limbId">): string {
  if (t.parentId) return t.parentId;
  if (t.limbId) return `limb:${t.limbId}`;
  return "seeds";
}

export function byOrder(a: { order: number; createdAt: number }, b: { order: number; createdAt: number }) {
  return a.order - b.order || a.createdAt - b.createdAt;
}

/** A thought is a seed (inbox) when it has no place in the tree yet. */
export function isUnplaced(t: Thought): boolean {
  return !t.parentId && !t.limbId;
}

export function ancestors(thoughts: ById, id: string): Thought[] {
  const out: Thought[] = [];
  const seen = new Set<string>();
  let cur = thoughts[id]?.parentId;
  while (cur && thoughts[cur] && !seen.has(cur)) {
    seen.add(cur);
    out.unshift(thoughts[cur]);
    cur = thoughts[cur].parentId;
  }
  return out;
}

export function descendants(idx: Map<string, Thought[]>, id: string): Thought[] {
  const out: Thought[] = [];
  const stack = [...(idx.get(id) ?? [])];
  while (stack.length) {
    const t = stack.pop()!;
    out.push(t);
    stack.push(...(idx.get(t.id) ?? []));
  }
  return out;
}

export function depthOf(thoughts: ById, id: string): number {
  return ancestors(thoughts, id).length;
}

/** Would making `newParentId` the parent of `id` create a cycle? */
export function wouldCycle(thoughts: ById, id: string, newParentId: string | null): boolean {
  let cur: string | null = newParentId;
  const seen = new Set<string>();
  while (cur) {
    if (cur === id) return true;
    if (seen.has(cur)) return true;
    seen.add(cur);
    cur = thoughts[cur]?.parentId ?? null;
  }
  return false;
}

/** Limb a thought effectively belongs to (walks up to the root). */
export function effectiveLimb(thoughts: ById, id: string): string | null {
  const chain = ancestors(thoughts, id);
  const root = chain[0] ?? thoughts[id];
  return root?.limbId ?? null;
}

export function isWilting(t: Thought, now: number, wiltWeeks: number): boolean {
  if (t.status === "blooming" || t.status === "pruned" || t.status === "dormant") return false;
  return now - t.touchedAt > wiltWeeks * WEEK;
}

/** 0 (fresh) → 1 (fully wilted), ramping over the week after the wilt threshold. */
export function wiltAmount(t: Thought, now: number, wiltWeeks: number): number {
  if (!isWilting(t, now, wiltWeeks)) return 0;
  const over = now - t.touchedAt - wiltWeeks * WEEK;
  return Math.min(1, 0.4 + over / (2 * WEEK));
}

export interface Filters {
  query: string;
  statuses: Status[];
  tag: string | null;
  limbId: string | null;
  wilting: boolean;
}

export const EMPTY_FILTERS: Filters = { query: "", statuses: [], tag: null, limbId: null, wilting: false };

export function filtersActive(f: Filters): boolean {
  return !!(f.query.trim() || f.statuses.length || f.tag || f.limbId || f.wilting);
}

export function matches(thoughts: ById, t: Thought, f: Filters, now: number, wiltWeeks: number): boolean {
  if (f.statuses.length && !f.statuses.includes(t.status)) return false;
  if (f.tag && !t.tags.includes(f.tag)) return false;
  if (f.limbId && effectiveLimb(thoughts, t.id) !== f.limbId) return false;
  if (f.wilting && !isWilting(t, now, wiltWeeks)) return false;
  const q = f.query.trim().toLowerCase();
  if (q) {
    const hay = `${t.title}\n${t.body}\n${t.tags.map((x) => "#" + x).join(" ")}`.toLowerCase();
    return q.split(/\s+/).every((w) => hay.includes(w));
  }
  return true;
}

export function allTags(thoughts: ById): string[] {
  const s = new Set<string>();
  for (const t of Object.values(thoughts)) for (const tag of t.tags) s.add(tag);
  return [...s].sort();
}

/** Parse `#tags` out of a captured line. */
export function parseCapture(line: string): { title: string; tags: string[] } {
  const tags: string[] = [];
  const title = line
    .replace(/(^|\s)#([\p{L}\p{N}_-]+)/gu, (_m, pre: string, tag: string) => {
      tags.push(tag.toLowerCase());
      return pre;
    })
    .replace(/\s+/g, " ")
    .trim();
  return { title: title || line.trim(), tags: [...new Set(tags)] };
}

export interface OutlineRow {
  kind: "thought";
  thought: Thought;
  depth: number;
  hasChildren: boolean;
  collapsed: boolean;
}

export interface OutlineHeader {
  kind: "limb" | "seeds";
  limb?: Limb;
  count: number;
  collapsed: boolean;
}

export type OutlineItem = OutlineRow | OutlineHeader;

/** Flatten the tree into visible rows for the Grove outline. */
export function outline(thoughts: ById, limbs: Limb[], collapsed: Record<string, boolean>, hidePruned: boolean): OutlineItem[] {
  const idx = childrenIndex(thoughts);
  const out: OutlineItem[] = [];
  const visible = (t: Thought) => !hidePruned || t.status !== "pruned";
  const walk = (key: string, depth: number) => {
    for (const t of idx.get(key) ?? []) {
      if (!visible(t)) continue;
      const kids = (idx.get(t.id) ?? []).filter(visible);
      const isCollapsed = !!collapsed[t.id];
      out.push({ kind: "thought", thought: t, depth, hasChildren: kids.length > 0, collapsed: isCollapsed });
      if (!isCollapsed) walk(t.id, depth + 1);
    }
  };
  const seeds = (idx.get("seeds") ?? []).filter(visible);
  const seedsCollapsed = !!collapsed["seeds"];
  out.push({ kind: "seeds", count: seeds.length, collapsed: seedsCollapsed });
  if (!seedsCollapsed) walk("seeds", 0);
  for (const limb of [...limbs].sort(byOrder)) {
    const key = `limb:${limb.id}`;
    const isCollapsed = !!collapsed[key];
    const count = (idx.get(key) ?? []).reduce((n, t) => n + 1 + descendants(idx, t.id).length, 0);
    out.push({ kind: "limb", limb, count, collapsed: isCollapsed });
    if (!isCollapsed) walk(key, 0);
  }
  return out;
}
