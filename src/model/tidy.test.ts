import { describe, expect, it } from "vitest";
import type { Limb, Link, Thought } from "./types";
import { tidySnapshot } from "./tidy";

const L = (id: string, name: string): Limb => ({ id, name, color: "#fff", order: 0, createdAt: 1 });
const T = (id: string, title: string, o: Partial<Thought> = {}): Thought => ({
  id,
  title,
  parentId: null,
  limbId: null,
  body: "",
  status: "seed",
  tags: [],
  order: 0,
  createdAt: 1,
  updatedAt: 1,
  touchedAt: 1,
  ...o,
});

function apply(s: { thoughts: Thought[]; limbs: Limb[]; links: Link[] }) {
  const r = tidySnapshot(s, 100);
  const gone = new Set(r.removed);
  const up = <X extends { id: string }>(xs: X[], ch: X[]) => {
    const m = new Map(xs.filter((x) => !gone.has(x.id)).map((x) => [x.id, x]));
    for (const c of ch) m.set(c.id, c);
    return [...m.values()];
  };
  return { r, thoughts: up(s.thoughts, r.thoughts), limbs: up(s.limbs, r.limbs), links: up(s.links, r.links) };
}

describe("tidy duplicates", () => {
  // Two devices that each made the starter tree, then synced.
  const snap = {
    limbs: [L("a1", "Work"), L("b1", "Work"), L("a2", "Getting started"), L("b2", "Getting Started")],
    thoughts: [
      T("x1", "Ship it", { limbId: "a1" }),
      T("y1", "Ship it", { limbId: "b1" }),
      T("x2", "Pick one feature", { parentId: "x1" }),
      T("y2", "Pick one feature", { parentId: "y1", tags: ["v1"] }),
      T("y3", "Only on B", { parentId: "y1" }),
      T("z", "Same title, different notes", { limbId: "a1", body: "one" }),
      T("z2", "Same title, different notes", { limbId: "a1", body: "two" }),
      T("g", "How it works", { limbId: "b2" }),
    ],
    links: [
      { id: "l1", from: "x2", to: "g", createdAt: 1 },
      { id: "l2", from: "y2", to: "g", createdAt: 1 },
    ],
  };

  it("merges same-name limbs and identical sibling thoughts, keeping everything unique", () => {
    const out = apply(snap);
    expect(out.limbs.map((l) => l.name).sort()).toEqual(["General", "Work"]);
    const titles = out.thoughts.map((t) => t.title).sort();
    expect(titles).toEqual([
      "How it works",
      "Only on B",
      "Pick one feature",
      "Same title, different notes",
      "Same title, different notes",
      "Ship it",
    ]);
    const ship = out.thoughts.find((t) => t.title === "Ship it")!;
    expect(ship.id).toBe("x1");
    expect(
      out.thoughts
        .filter((t) => t.parentId === "x1")
        .map((t) => t.title)
        .sort(),
    ).toEqual(["Only on B", "Pick one feature"]);
    expect(out.thoughts.find((t) => t.title === "Pick one feature")!.tags).toEqual(["v1"]);
    expect(out.thoughts.find((t) => t.id === "g")!.limbId).toBe("a2");
    expect(out.links).toHaveLength(1);
  });

  it("is deterministic and a no-op once tidy", () => {
    const once = apply(snap);
    const again = tidySnapshot({ thoughts: once.thoughts, limbs: once.limbs, links: once.links }, 200);
    expect(again.removed).toEqual([]);
    expect(again.thoughts).toEqual([]);
    expect(again.limbs).toEqual([]);
    const reversed = apply({ thoughts: [...snap.thoughts].reverse(), limbs: [...snap.limbs].reverse(), links: [...snap.links].reverse() });
    expect(reversed.thoughts.map((t) => t.id).sort()).toEqual(once.thoughts.map((t) => t.id).sort());
  });
});
