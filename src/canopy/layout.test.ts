import { describe, expect, it } from "vitest";
import type { Limb, Thought } from "../model/types";
import { layoutTree } from "./layout";

const limb = (id: string, order: number): Limb => ({ id, name: id, color: "#fff", order, createdAt: 0 });
let clock = 0;
const t = (id: string, parentId: string | null, limbId: string | null = null): Thought => ({
  id,
  parentId,
  limbId,
  title: id,
  body: "",
  status: "seed",
  tags: [],
  order: 0,
  createdAt: ++clock,
  updatedAt: 0,
  touchedAt: 0,
});
const byId = (ts: Thought[]) => Object.fromEntries(ts.map((x) => [x.id, x]));

describe("canopy layout", () => {
  const limbs = [limb("work", 0), limb("life", 1)];
  const base = [t("a", null, "work"), t("a1", "a"), t("a2", "a"), t("b", null, "life"), t("b1", "b"), t("s", null)];

  it("is deterministic", () => {
    const x = layoutTree(byId(base), limbs);
    const y = layoutTree(byId([...base].reverse()), limbs);
    for (const [id, seg] of x.nodes) expect(y.nodes.get(id)).toEqual(seg);
  });

  it("never moves existing nodes when new thoughts, limbs or siblings are added", () => {
    const before = layoutTree(byId(base), limbs);
    const grown = [...base, t("a3", "a"), t("a1x", "a1"), t("c", null, "ideas"), t("s2", null)];
    for (let i = 0; i < 200; i++) grown.push(t(`n${i}`, i % 2 ? "a" : "b1"));
    const after = layoutTree(byId(grown), [...limbs, limb("ideas", 2)]);
    for (const [id, seg] of before.nodes) expect(after.nodes.get(id)).toEqual(seg);
    for (const [id, seg] of before.limbs) expect(after.limbs.get(id)).toEqual(seg);
  });

  it("fans siblings apart instead of clumping them", () => {
    const kids: Thought[] = [t("hub", null, "work")];
    for (let i = 0; i < 8; i++) kids.push(t(`s${i}`, "hub"));
    const l = layoutTree(byId(kids), limbs);
    const dirs = kids.slice(1).map((k) => l.nodes.get(k.id)!.dir);
    let minAngle = Math.PI;
    for (let i = 0; i < dirs.length; i++)
      for (let j = i + 1; j < dirs.length; j++) {
        const dot = dirs[i][0] * dirs[j][0] + dirs[i][1] * dirs[j][1] + dirs[i][2] * dirs[j][2];
        minAngle = Math.min(minAngle, Math.acos(Math.min(1, dot)));
      }
    expect(minAngle).toBeGreaterThan(0.2); // > ~11° between any two of 8 siblings
    // Fork points are staggered along the parent, not stacked at the tip.
    const hub = l.nodes.get("hub")!;
    const along = kids.slice(1).map((k) => {
      const s = l.nodes.get(k.id)!.start;
      return Math.hypot(s[0] - hub.start[0], s[1] - hub.start[1], s[2] - hub.start[2]);
    });
    expect(Math.max(...along) - Math.min(...along)).toBeGreaterThan(0.5);
  });

  it("children start on their parent and grow upward-ish", () => {
    const l = layoutTree(byId(base), limbs);
    const a = l.nodes.get("a")!;
    const a1 = l.nodes.get("a1")!;
    // a1 forks from somewhere along a
    const along = [0, 1, 2].map((k) => (a1.start[k] - a.start[k]) / (a.end[k] - a.start[k] || 1));
    expect(Math.min(...along)).toBeGreaterThan(0.3);
    expect(a1.depth).toBe(1);
    expect(a1.radius).toBeLessThan(a.radius);
  });

  it("survives cycles and missing parents", () => {
    const bad = [t("x", "y"), t("y", "x"), t("z", "missing")];
    const l = layoutTree(byId(bad), []);
    expect(l.nodes.size).toBe(3);
  });

  it("lays out thousands of nodes quickly", () => {
    const many: Thought[] = [t("root", null, "work")];
    for (let i = 0; i < 5000; i++) many.push(t(`k${i}`, i < 50 ? "root" : `k${i % 50}`));
    const t0 = performance.now();
    const l = layoutTree(byId(many), limbs);
    expect(l.nodes.size).toBe(5001);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
