import { useMemo } from "react";
import { ancestors, childrenIndex, filtersActive, matches, outline, type OutlineItem, type OutlineRow } from "../model/tree";
import { useStore } from "../store/store";

export type Row = OutlineRow & { crumb?: string };
export type Item = OutlineItem | Row;

/** The rows the Grove shows right now — the full outline, or a flat result list while filtering. */
export function useVisibleItems(): { items: Item[]; filtering: boolean } {
  const thoughts = useStore((s) => s.thoughts);
  const limbs = useStore((s) => s.limbs);
  const collapsed = useStore((s) => s.collapsed);
  const hidePruned = useStore((s) => s.hidePruned);
  const filters = useStore((s) => s.filters);
  const wiltWeeks = useStore((s) => s.settings.wiltWeeks);

  return useMemo(() => {
    const limbList = Object.values(limbs);
    if (!filtersActive(filters)) {
      return { items: outline(thoughts, limbList, collapsed, hidePruned), filtering: false };
    }
    const now = Date.now();
    const idx = childrenIndex(thoughts);
    const rows: Row[] = Object.values(thoughts)
      .filter(
        (t) =>
          (!hidePruned || t.status !== "pruned" || filters.statuses.includes("pruned")) && matches(thoughts, t, filters, now, wiltWeeks),
      )
      .sort((a, b) => b.touchedAt - a.touchedAt)
      .map((t) => {
        const chain = ancestors(thoughts, t.id);
        const root = chain[0] ?? t;
        const limb = root.limbId ? limbs[root.limbId]?.name : "Seeds";
        return {
          kind: "thought" as const,
          thought: t,
          depth: 0,
          hasChildren: (idx.get(t.id)?.length ?? 0) > 0,
          collapsed: true,
          crumb: [limb ?? "Seeds", ...chain.map((a) => a.title)].join(" › "),
        };
      });
    return { items: rows, filtering: true };
  }, [thoughts, limbs, collapsed, hidePruned, filters, wiltWeeks]);
}

export function thoughtRows(items: Item[]): Row[] {
  return items.filter((i): i is Row => i.kind === "thought");
}
