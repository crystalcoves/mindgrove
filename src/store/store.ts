import { create } from "zustand";
import { db as dexie, persist as db, loadAll } from "../db/db";
import { REFLECTION_LIMB_ID, tidySnapshot } from "../model/tidy";
import { uid } from "../lib/id";
import {
  EMPTY_FILTERS,
  ancestors,
  byOrder,
  childrenIndex,
  parentKey,
  parseCapture,
  wouldCycle,
  type ById,
  type Filters,
} from "../model/tree";
import type { Limb, Link, Settings, Snapshot, Status, Thought } from "../model/types";
import { demoSnapshot } from "./demo";
import { pairKey } from "../model/suggest";
import type { SyncDoc, Tombstones } from "../sync/merge";

export type View = "grove" | "canopy";
export type PaletteMode = "go" | "link" | "move";

export const DEFAULT_SETTINGS: Settings = {
  theme: "holo",
  reducedMotion: typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches,
  particles: "high",
  wiltWeeks: 3,
  reflectDaily: true,
};

export const LIMB_COLORS = ["#4fe3ff", "#ffb020", "#b07bff", "#5dffa8", "#ff6fae", "#ffe14f", "#6f9bff", "#ff8a4f"];

export interface Toast {
  id: string;
  text: string;
  action?: { label: string; run: () => void };
}

/** Where a thought goes: under a parent, at the root of a limb, or into the seed inbox. */
export interface Place {
  parentId: string | null;
  limbId: string | null;
}

interface State {
  ready: boolean;
  thoughts: ById;
  limbs: Record<string, Limb>;
  links: Record<string, Link>;
  settings: Settings;

  view: View;
  selectedId: string | null;
  /** Thought whose title is being edited inline in the Grove. */
  editingId: string | null;
  filters: Filters;
  collapsed: Record<string, boolean>;
  hidePruned: boolean;
  /** True while the inline editor was opened on a brand-new thought (Enter chains another). */
  editFlow: boolean;
  captureOpen: boolean;
  paletteOpen: boolean;
  paletteMode: PaletteMode;
  settingsOpen: boolean;
  tendOpen: boolean;
  detailOpen: boolean;
  toasts: Toast[];
  /** Suggested vines the user said no to, keyed by pairKey. */
  dismissedVines: Record<string, boolean>;
  /** Deletion times by id, so deletions reach other devices through sync. */
  tombstones: Tombstones;
  /** Ids born this session, with birth time, so the canopy can animate their growth. */
  births: Record<string, number>;
}

interface Actions {
  init(): Promise<void>;
  capture(text: string, place?: Partial<Place>): string | null;
  addThought(fields: Partial<Thought> & { title: string }): Thought;
  update(id: string, patch: Partial<Omit<Thought, "id" | "createdAt">>): void;
  setStatus(id: string, status: Status): void;
  touch(id: string): void;
  move(id: string, place: Place, beforeId?: string | null): boolean;
  indent(id: string): void;
  outdent(id: string): void;
  nudge(id: string, dir: -1 | 1): void;
  remove(id: string, opts?: { silent?: boolean }): void;
  cycleStatus(id: string, dir?: 1 | -1): void;
  /** Create an empty thought next to / under `id` and start editing it. */
  sprout(id: string | null, where: "sibling" | "child"): string;

  addLimb(name: string, color?: string): Limb;
  updateLimb(id: string, patch: Partial<Omit<Limb, "id">>): void;
  removeLimb(id: string): void;
  /** Put limb `id` before `beforeId` (or last). */
  reorderLimb(id: string, beforeId: string | null): void;

  addLink(from: string, to: string): void;
  removeLink(id: string): void;
  dismissVine(a: string, b: string): void;

  replaceAll(s: Snapshot): void;
  /** Replace data with a merged sync document, keeping UI state. */
  applySync(doc: SyncDoc): void;
  /** Take in data another open copy of the app already stored (no re-write). */
  absorb(doc: SyncDoc): void;
  /** Merge duplicates (same-name limbs, identical sibling thoughts); true if anything changed. */
  tidyUp(): boolean;
  merge(s: Snapshot): void;
  /** Bring back what `s` has and this grove doesn't (e.g. from a backup); returns how many thoughts came back. */
  restoreMissing(s: Snapshot): number;
  snapshot(): Snapshot;

  setSettings(patch: Partial<Settings>): void;
  setView(v: View): void;
  toggleView(): void;
  select(id: string | null, opts?: { open?: boolean }): void;
  setEditing(id: string | null, flow?: boolean): void;
  setFilters(patch: Partial<Filters>): void;
  clearFilters(): void;
  toggleCollapsed(key: string, value?: boolean): void;
  setHidePruned(v: boolean): void;
  openCapture(v: boolean): void;
  openPalette(v: boolean, mode?: PaletteMode): void;
  openSettings(v: boolean): void;
  openTend(v: boolean): void;
  openDetail(v: boolean): void;
  toast(text: string, action?: Toast["action"]): void;
  dismissToast(id: string): void;
}

export type Store = State & Actions;

const now = () => Date.now();
let initOnce: Promise<void> | null = null;

export const useStore = create<Store>()((set, get) => {
  const siblings = (p: Place, thoughts = get().thoughts) => childrenIndex(thoughts).get(parentKey(p)) ?? [];

  const nextOrder = (p: Place, thoughts = get().thoughts) => {
    const sibs = siblings(p, thoughts);
    return sibs.length ? sibs[sibs.length - 1].order + 1 : 0;
  };

  const putThoughts = (list: Thought[]) => {
    if (!list.length) return;
    set((s) => {
      const thoughts = { ...s.thoughts };
      for (const t of list) thoughts[t.id] = t;
      return { thoughts };
    });
    db.putThoughts(list);
  };

  const bury = (ids: string[]) => {
    if (!ids.length) return;
    const ts = now();
    const tombstones = { ...get().tombstones };
    for (const id of ids) tombstones[id] = ts;
    set({ tombstones });
    db.setKV("tombstones", tombstones);
  };
  const unbury = (ids: string[]) => {
    const tombstones = { ...get().tombstones };
    let changed = false;
    for (const id of ids)
      if (id in tombstones) {
        delete tombstones[id];
        changed = true;
      }
    if (!changed) return;
    set({ tombstones });
    db.setKV("tombstones", tombstones);
  };

  const normalizePlace = (p: Partial<Place>): Place => {
    const parentId = p.parentId ?? null;
    // Only roots carry a limb; children inherit through their ancestors.
    return { parentId, limbId: parentId ? null : (p.limbId ?? null) };
  };

  return {
    ready: false,
    thoughts: {},
    limbs: {},
    links: {},
    settings: DEFAULT_SETTINGS,
    view: "grove",
    selectedId: null,
    editingId: null,
    editFlow: false,
    filters: EMPTY_FILTERS,
    collapsed: {},
    hidePruned: true,
    captureOpen: false,
    paletteOpen: false,
    paletteMode: "go",
    settingsOpen: false,
    tendOpen: false,
    detailOpen: false,
    toasts: [],
    births: {},
    dismissedVines: {},
    tombstones: {},

    init() {
      // Idempotent: StrictMode and HMR may call this more than once.
      initOnce ??= (async () => {
        const data = await loadAll();
        let snap: Snapshot = data;
        if (!data.seeded && data.thoughts.length === 0 && data.limbs.length === 0) {
          snap = demoSnapshot(now());
          db.replaceAll(snap);
          db.setKV("seeded", true);
        }
        set({
          ready: true,
          thoughts: Object.fromEntries(snap.thoughts.map((t) => [t.id, t])),
          limbs: Object.fromEntries(snap.limbs.map((l) => [l.id, l])),
          links: Object.fromEntries(snap.links.map((l) => [l.id, l])),
          settings: { ...DEFAULT_SETTINGS, ...(data.settings ?? {}) },
          dismissedVines: data.dismissedVines,
          tombstones: data.tombstones,
        });
        // One-time: add the Reflection limb. A fixed id means two devices that
        // both add it end up with one limb after syncing, not two.
        if (!(await dexie.kv.get("added:reflection"))?.value) {
          const limbs = Object.values(get().limbs);
          if (!limbs.some((l) => l.id === REFLECTION_LIMB_ID || l.name.trim().toLowerCase() === "reflection")) {
            const ts = now();
            const limb: Limb = {
              id: REFLECTION_LIMB_ID,
              name: "Reflection",
              color: "#ff6fae",
              order: limbs.length ? Math.max(...limbs.map((l) => l.order)) + 1 : 0,
              createdAt: ts,
              updatedAt: ts,
            };
            set((st) => ({ limbs: { ...st.limbs, [limb.id]: limb } }));
            db.putLimbs([limb]);
          }
          db.setKV("added:reflection", true);
        }
        get().tidyUp();
      })();
      return initOnce;
    },

    capture(text, place = {}) {
      const { title, tags } = parseCapture(text);
      if (!title) return null;
      const p = normalizePlace(place);
      const t = get().addThought({ title, tags, ...p });
      return t.id;
    },

    addThought(fields) {
      const ts = now();
      const p = normalizePlace(fields);
      const t: Thought = {
        body: "",
        status: "seed",
        tags: [],
        order: nextOrder(p),
        createdAt: ts,
        updatedAt: ts,
        touchedAt: ts,
        ...fields,
        ...p,
        id: fields.id ?? uid(),
      };
      putThoughts([t]);
      set((s) => ({ births: { ...s.births, [t.id]: performanceNow() } }));
      return t;
    },

    update(id, patch) {
      const t = get().thoughts[id];
      if (!t) return;
      const ts = now();
      putThoughts([{ ...t, ...patch, updatedAt: ts, touchedAt: ts }]);
    },

    setStatus(id, status) {
      get().update(id, { status });
    },

    touch(id) {
      const t = get().thoughts[id];
      if (!t) return;
      putThoughts([{ ...t, touchedAt: now() }]);
    },

    move(id, place, beforeId = null) {
      const { thoughts } = get();
      const t = thoughts[id];
      if (!t) return false;
      const p = normalizePlace(place);
      if (p.parentId && (p.parentId === id || wouldCycle(thoughts, id, p.parentId))) return false;
      const sibs = siblings(p).filter((x) => x.id !== id);
      let order: number;
      const i = beforeId ? sibs.findIndex((x) => x.id === beforeId) : -1;
      if (i === -1) order = sibs.length ? sibs[sibs.length - 1].order + 1 : 0;
      else if (i === 0) order = sibs[0].order - 1;
      else order = (sibs[i - 1].order + sibs[i].order) / 2;
      const ts = now();
      putThoughts([{ ...t, ...p, order, updatedAt: ts, touchedAt: ts }]);
      return true;
    },

    indent(id) {
      const t = get().thoughts[id];
      if (!t) return;
      const sibs = siblings(t);
      const i = sibs.findIndex((x) => x.id === id);
      if (i <= 0) return;
      const newParent = sibs[i - 1];
      get().move(id, { parentId: newParent.id, limbId: null });
      get().toggleCollapsed(newParent.id, false);
    },

    outdent(id) {
      const { thoughts } = get();
      const t = thoughts[id];
      if (!t?.parentId) return;
      const parent = thoughts[t.parentId];
      if (!parent) return;
      const after = siblings(parent);
      const pi = after.findIndex((x) => x.id === parent.id);
      const before = after[pi + 1]?.id ?? null;
      get().move(id, { parentId: parent.parentId, limbId: parent.limbId }, before);
    },

    nudge(id, dir) {
      const t = get().thoughts[id];
      if (!t) return;
      const sibs = siblings(t);
      const i = sibs.findIndex((x) => x.id === id);
      const j = i + dir;
      if (j < 0 || j >= sibs.length) return;
      const other = sibs[j];
      const ts = now();
      putThoughts([
        { ...t, order: other.order, updatedAt: ts },
        { ...other, order: t.order, updatedAt: ts },
      ]);
    },

    remove(id, opts) {
      const { thoughts, links, selectedId } = get();
      const t = thoughts[id];
      if (!t) return;
      // Follow-ups are lifted into the removed thought's place, not deleted.
      const kids = childrenIndex(thoughts).get(id) ?? [];
      const sibs = siblings(t);
      const i = sibs.findIndex((x) => x.id === id);
      const lo = t.order;
      const hi = sibs[i + 1]?.order ?? lo + 1;
      const step = (hi - lo) / (kids.length + 1);
      const ts = now();
      const lifted = kids.map((k, n) => ({ ...k, parentId: t.parentId, limbId: t.limbId, order: lo + step * n, updatedAt: ts }));
      const deadLinks = Object.values(links).filter((l) => l.from === id || l.to === id);

      set((s) => {
        const next = { ...s.thoughts };
        delete next[id];
        for (const k of lifted) next[k.id] = k;
        const nextLinks = { ...s.links };
        for (const l of deadLinks) delete nextLinks[l.id];
        return {
          thoughts: next,
          links: nextLinks,
          selectedId: selectedId === id ? (t.parentId ?? kids[0]?.id ?? sibs[i + 1]?.id ?? sibs[i - 1]?.id ?? null) : selectedId,
        };
      });
      // Tombstone first, so another open copy never sees the deletion without it.
      bury([id, ...deadLinks.map((l) => l.id)]);
      db.deleteThoughts([id]);
      db.putThoughts(lifted);
      db.deleteLinks(deadLinks.map((l) => l.id));

      if (opts?.silent) return;
      get().toast(`Removed “${truncate(t.title || "untitled", 40)}”`, {
        label: "Undo",
        run: () => {
          // Restored records are newer than their tombstones, so the undo syncs too.
          const at = now();
          putThoughts([t, ...kids].map((x) => ({ ...x, updatedAt: at })));
          const back = deadLinks.map((l) => ({ ...l, createdAt: at }));
          set((s) => ({ links: { ...s.links, ...Object.fromEntries(back.map((l) => [l.id, l])) }, selectedId: id }));
          db.putLinks(back);
          unbury([id, ...deadLinks.map((l) => l.id)]);
        },
      });
    },

    cycleStatus(id, dir = 1) {
      const t = get().thoughts[id];
      if (!t) return;
      const loop: Status[] = ["seed", "growing", "blooming", "dormant"];
      const i = loop.indexOf(t.status);
      const next = i === -1 ? "growing" : loop[(i + dir + loop.length) % loop.length];
      get().setStatus(id, next);
    },

    sprout(id, where) {
      const { thoughts } = get();
      const ref = id ? thoughts[id] : null;
      let t: Thought;
      if (ref && where === "child") {
        t = get().addThought({ title: "", parentId: ref.id, status: "growing" });
        get().toggleCollapsed(ref.id, false);
      } else if (ref) {
        const sibs = siblings(ref);
        const i = sibs.findIndex((x) => x.id === ref.id);
        const next = sibs[i + 1];
        const order = next ? (ref.order + next.order) / 2 : ref.order + 1;
        t = get().addThought({
          title: "",
          parentId: ref.parentId,
          limbId: ref.limbId,
          order,
          status: ref.status === "seed" ? "seed" : "growing",
        });
      } else {
        t = get().addThought({ title: "" });
      }
      set({ selectedId: t.id, editingId: t.id, editFlow: true });
      return t.id;
    },

    addLimb(name, color) {
      const limbs = Object.values(get().limbs);
      const limb: Limb = {
        id: uid(),
        name: name.trim() || "New limb",
        color: color ?? LIMB_COLORS[limbs.length % LIMB_COLORS.length],
        order: limbs.length ? Math.max(...limbs.map((l) => l.order)) + 1 : 0,
        createdAt: now(),
        updatedAt: now(),
      };
      set((s) => ({ limbs: { ...s.limbs, [limb.id]: limb }, births: { ...s.births, [limb.id]: performanceNow() } }));
      db.putLimbs([limb]);
      return limb;
    },

    updateLimb(id, patch) {
      const l = get().limbs[id];
      if (!l) return;
      const next = { ...l, ...patch, updatedAt: now() };
      set((s) => ({ limbs: { ...s.limbs, [id]: next } }));
      db.putLimbs([next]);
    },

    reorderLimb(id, beforeId) {
      const all = Object.values(get().limbs).sort(byOrder);
      const limb = get().limbs[id];
      if (!limb || id === beforeId) return;
      const rest = all.filter((l) => l.id !== id);
      const i = beforeId ? rest.findIndex((l) => l.id === beforeId) : -1;
      const next = [...rest];
      next.splice(i === -1 ? rest.length : i, 0, limb);
      // Renumber so orders stay small integers (they seed the canopy layout).
      const ts = now();
      const changed = next.map((l, n) => ({ ...l, order: n, updatedAt: ts })).filter((l) => l.order !== get().limbs[l.id].order);
      if (!changed.length) return;
      set((s) => ({ limbs: { ...s.limbs, ...Object.fromEntries(changed.map((l) => [l.id, l])) } }));
      db.putLimbs(changed);
    },

    removeLimb(id) {
      const { thoughts, limbs } = get();
      const limb = limbs[id];
      if (!limb) return;
      // Its branches fall back to the seed inbox rather than vanishing.
      const roots = Object.values(thoughts).filter((t) => !t.parentId && t.limbId === id);
      let order = nextOrder({ parentId: null, limbId: null });
      const ts = now();
      const moved = roots.sort(byOrder).map((t) => ({ ...t, limbId: null, order: order++, updatedAt: ts }));
      set((s) => {
        const next = { ...s.limbs };
        delete next[id];
        return { limbs: next };
      });
      bury([id]);
      putThoughts(moved);
      db.deleteLimb(id);
      get().toast(`Removed limb “${limb.name}” — ${moved.length} branch${moved.length === 1 ? "" : "es"} returned to seeds`);
    },

    addLink(from, to) {
      if (from === to) return;
      const exists = Object.values(get().links).some((l) => (l.from === from && l.to === to) || (l.from === to && l.to === from));
      if (exists) return;
      const link: Link = { id: uid(), from, to, createdAt: now() };
      set((s) => ({ links: { ...s.links, [link.id]: link } }));
      db.putLinks([link]);
      get().touch(from);
    },

    removeLink(id) {
      set((s) => {
        const next = { ...s.links };
        delete next[id];
        return { links: next };
      });
      bury([id]);
      db.deleteLinks([id]);
    },

    dismissVine(a, b) {
      const dismissedVines = { ...get().dismissedVines, [pairKey(a, b)]: true };
      set({ dismissedVines });
      db.setKV("dismissedVines", dismissedVines);
    },

    replaceAll(s) {
      // Restoring a backup deletes what it doesn't contain — on synced devices too.
      const keep = new Set([...s.thoughts, ...s.limbs, ...s.links].map((r) => r.id));
      const cur = get();
      bury([...Object.keys(cur.thoughts), ...Object.keys(cur.limbs), ...Object.keys(cur.links)].filter((id) => !keep.has(id)));
      const ts = now();
      s = {
        thoughts: s.thoughts.map((t) => ({ ...t, updatedAt: Math.max(t.updatedAt, ts) })),
        limbs: s.limbs.map((l) => ({ ...l, updatedAt: ts })),
        links: s.links.map((l) => ({ ...l, createdAt: ts })),
      };
      set({
        thoughts: Object.fromEntries(s.thoughts.map((t) => [t.id, t])),
        limbs: Object.fromEntries(s.limbs.map((l) => [l.id, l])),
        links: Object.fromEntries(s.links.map((l) => [l.id, l])),
        selectedId: null,
        editingId: null,
      });
      db.replaceAll(s);
    },

    applySync(doc) {
      set((st) => ({
        thoughts: Object.fromEntries(doc.thoughts.map((t) => [t.id, t])),
        limbs: Object.fromEntries(doc.limbs.map((l) => [l.id, l])),
        links: Object.fromEntries(doc.links.map((l) => [l.id, l])),
        tombstones: doc.tombstones,
        selectedId: st.selectedId && doc.thoughts.some((t) => t.id === st.selectedId) ? st.selectedId : null,
        editingId: st.editingId && doc.thoughts.some((t) => t.id === st.editingId) ? st.editingId : null,
      }));
      db.replaceAll(doc);
      db.setKV("tombstones", doc.tombstones);
    },

    tidyUp() {
      const r = tidySnapshot(get().snapshot());
      if (!r.removed.length && !r.thoughts.length && !r.limbs.length && !r.links.length) return false;
      bury(r.removed);
      const gone = new Set(r.removed);
      set((st) => {
        const keep = <X extends { id: string }>(m: Record<string, X>, ch: X[]) => {
          const next = Object.fromEntries(Object.entries(m).filter(([id]) => !gone.has(id)));
          for (const c of ch) next[c.id] = c;
          return next;
        };
        return {
          thoughts: keep(st.thoughts, r.thoughts),
          limbs: keep(st.limbs, r.limbs),
          links: keep(st.links, r.links),
          selectedId: st.selectedId && gone.has(st.selectedId) ? null : st.selectedId,
        };
      });
      db.deleteThoughts(r.removed);
      db.deleteLinks(r.removed);
      for (const id of r.removed) db.deleteLimb(id);
      db.putThoughts(r.thoughts);
      db.putLimbs(r.limbs);
      db.putLinks(r.links);
      return true;
    },

    absorb(doc) {
      set((st) => ({
        thoughts: Object.fromEntries(doc.thoughts.map((t) => [t.id, t])),
        limbs: Object.fromEntries(doc.limbs.map((l) => [l.id, l])),
        links: Object.fromEntries(doc.links.map((l) => [l.id, l])),
        tombstones: doc.tombstones,
        selectedId: st.selectedId && doc.thoughts.some((t) => t.id === st.selectedId) ? st.selectedId : null,
      }));
    },

    merge(s) {
      set((st) => ({
        thoughts: { ...st.thoughts, ...Object.fromEntries(s.thoughts.map((t) => [t.id, t])) },
        limbs: { ...st.limbs, ...Object.fromEntries(s.limbs.map((l) => [l.id, l])) },
        links: { ...st.links, ...Object.fromEntries(s.links.map((l) => [l.id, l])) },
      }));
      db.putThoughts(s.thoughts);
      db.putLimbs(s.limbs);
      db.putLinks(s.links);
    },

    restoreMissing(s) {
      const cur = get();
      const ts = now();
      // Newer than any tombstone, so the restored records also sync back to other devices.
      const limbs = s.limbs.filter((l) => !cur.limbs[l.id]).map((l) => ({ ...l, updatedAt: ts }));
      const limbIds = new Set([...Object.keys(cur.limbs), ...limbs.map((l) => l.id)]);
      const missing = s.thoughts.filter((t) => !cur.thoughts[t.id]);
      const ids = new Set([...Object.keys(cur.thoughts), ...missing.map((t) => t.id)]);
      const thoughts = missing.map((t) => ({
        ...t,
        parentId: t.parentId && ids.has(t.parentId) ? t.parentId : null,
        limbId: t.parentId && ids.has(t.parentId) ? null : t.limbId && limbIds.has(t.limbId) ? t.limbId : null,
        updatedAt: ts,
      }));
      const links = s.links.filter((l) => !cur.links[l.id] && ids.has(l.from) && ids.has(l.to)).map((l) => ({ ...l, createdAt: ts }));
      unbury([...limbs, ...thoughts, ...links].map((r) => r.id));
      if (limbs.length) {
        set((st) => ({ limbs: { ...st.limbs, ...Object.fromEntries(limbs.map((l) => [l.id, l])) } }));
        db.putLimbs(limbs);
      }
      putThoughts(thoughts);
      if (links.length) {
        set((st) => ({ links: { ...st.links, ...Object.fromEntries(links.map((l) => [l.id, l])) } }));
        db.putLinks(links);
      }
      return thoughts.length;
    },

    snapshot() {
      const { thoughts, limbs, links } = get();
      return { thoughts: Object.values(thoughts), limbs: Object.values(limbs), links: Object.values(links) };
    },

    setSettings(patch) {
      const settings = { ...get().settings, ...patch };
      set({ settings });
      db.setKV("settings", settings);
    },

    setView: (view) => set({ view }),
    toggleView: () => set((s) => ({ view: s.view === "grove" ? "canopy" : "grove" })),

    select(id, opts) {
      set((s) => ({ selectedId: id, detailOpen: opts?.open ?? (id ? s.detailOpen : false) }));
      if (id) {
        // Reveal the selection in the outline.
        const { thoughts } = get();
        if (!thoughts[id]) return;
        const open: Record<string, boolean> = {};
        for (const a of ancestors(thoughts, id)) open[a.id] = false;
        open[parentKey(rootOf(thoughts, id))] = false;
        set((s) => ({ collapsed: { ...s.collapsed, ...open } }));
      }
    },

    setEditing: (editingId, flow = false) => set({ editingId, editFlow: flow }),
    setFilters: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),
    clearFilters: () => set({ filters: EMPTY_FILTERS }),
    toggleCollapsed: (key, value) => set((s) => ({ collapsed: { ...s.collapsed, [key]: value ?? !s.collapsed[key] } })),
    setHidePruned: (hidePruned) => set({ hidePruned }),
    openCapture: (captureOpen) => set({ captureOpen, paletteOpen: false }),
    openPalette: (paletteOpen, mode = "go") => set({ paletteOpen, paletteMode: mode, captureOpen: false }),
    openSettings: (settingsOpen) => set({ settingsOpen }),
    openTend: (tendOpen) => set({ tendOpen }),
    openDetail: (detailOpen) => set({ detailOpen }),

    toast(text, action) {
      const t: Toast = { id: uid(6), text, action };
      set((s) => ({ toasts: [...s.toasts.slice(-2), t] }));
      setTimeout(() => get().dismissToast(t.id), action ? 6000 : 3200);
    },
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  };
});

function rootOf(thoughts: ById, id: string): Thought {
  let t = thoughts[id];
  const seen = new Set<string>();
  while (t.parentId && thoughts[t.parentId] && !seen.has(t.id)) {
    seen.add(t.id);
    t = thoughts[t.parentId];
  }
  return t;
}

function performanceNow() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
