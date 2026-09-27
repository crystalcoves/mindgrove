import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/db";
import { childrenIndex, outline, parseCapture } from "../model/tree";
import { useStore } from "./store";

const s = () => useStore.getState();
const kids = (key: string) => (childrenIndex(s().thoughts).get(key) ?? []).map((t) => t.title);

beforeEach(async () => {
  await db.kv.put({ key: "seeded", value: true });
  s().replaceAll({ thoughts: [], limbs: [], links: [] });
});

describe("capture", () => {
  it("drops a seed into the inbox with parsed tags", () => {
    const id = s().capture("Call mum about the trip #family #Plans")!;
    const t = s().thoughts[id];
    expect(t.title).toBe("Call mum about the trip");
    expect(t.tags).toEqual(["family", "plans"]);
    expect(t.status).toBe("seed");
    expect(t.parentId).toBeNull();
    expect(t.limbId).toBeNull();
    expect(kids("seeds")).toEqual(["Call mum about the trip"]);
  });

  it("ignores blank input", () => {
    expect(s().capture("   ")).toBeNull();
  });

  it("keeps a tag-only capture readable", () => {
    expect(parseCapture("#idea").title).toBe("#idea");
  });

  it("persists to IndexedDB", async () => {
    const id = s().capture("persist me")!;
    await new Promise((r) => setTimeout(r, 20));
    expect((await db.thoughts.get(id))?.title).toBe("persist me");
  });
});

describe("tree editing", () => {
  it("plants, indents, outdents and reorders", () => {
    const limb = s().addLimb("Work");
    const a = s().capture("A", { limbId: limb.id })!;
    const b = s().capture("B", { limbId: limb.id })!;
    const c = s().capture("C", { limbId: limb.id })!;
    expect(kids(`limb:${limb.id}`)).toEqual(["A", "B", "C"]);

    s().indent(b); // B under A
    expect(s().thoughts[b].parentId).toBe(a);
    expect(s().thoughts[b].limbId).toBeNull();
    expect(kids(a)).toEqual(["B"]);

    s().indent(a); // first sibling can't indent
    expect(s().thoughts[a].parentId).toBeNull();

    s().outdent(b); // back after A, before C
    expect(kids(`limb:${limb.id}`)).toEqual(["A", "B", "C"]);

    s().nudge(c, -1);
    expect(kids(`limb:${limb.id}`)).toEqual(["A", "C", "B"]);
  });

  it("refuses to re-parent a thought under its own descendant", () => {
    const a = s().capture("A")!;
    const b = s().capture("B", { parentId: a })!;
    const c = s().capture("C", { parentId: b })!;
    expect(s().move(a, { parentId: c, limbId: null })).toBe(false);
    expect(s().move(a, { parentId: a, limbId: null })).toBe(false);
    expect(s().thoughts[a].parentId).toBeNull();
  });

  it("moves before a sibling", () => {
    const a = s().capture("A")!;
    s().capture("B");
    const c = s().capture("C")!;
    s().move(c, { parentId: null, limbId: null }, a);
    expect(kids("seeds")).toEqual(["C", "A", "B"]);
  });

  it("removing a thought lifts its follow-ups and drops its vines; undo restores", () => {
    const a = s().capture("A")!;
    const b = s().capture("B", { parentId: a })!;
    s().capture("B1", { parentId: b });
    s().capture("B2", { parentId: b });
    const c = s().capture("C", { parentId: a })!;
    s().addLink(b, c);
    expect(Object.keys(s().links)).toHaveLength(1);

    s().remove(b);
    expect(kids(a)).toEqual(["B1", "B2", "C"]);
    expect(Object.keys(s().links)).toHaveLength(0);

    s().toasts.at(-1)!.action!.run();
    expect(kids(a)).toEqual(["B", "C"]);
    expect(kids(b)).toEqual(["B1", "B2"]);
    expect(Object.keys(s().links)).toHaveLength(1);
  });

  it("does not duplicate links in either direction", () => {
    const a = s().capture("A")!;
    const b = s().capture("B")!;
    s().addLink(a, b);
    s().addLink(b, a);
    s().addLink(a, a);
    expect(Object.keys(s().links)).toHaveLength(1);
  });

  it("removing a limb returns its branches to seeds", () => {
    const limb = s().addLimb("Temp");
    const a = s().capture("A", { limbId: limb.id })!;
    s().capture("A1", { parentId: a });
    s().removeLimb(limb.id);
    expect(s().thoughts[a].limbId).toBeNull();
    expect(kids("seeds")).toEqual(["A"]);
    expect(kids(a)).toEqual(["A1"]);
  });

  it("selecting a thought expands its ancestors in the outline", () => {
    const limb = s().addLimb("L");
    const a = s().capture("A", { limbId: limb.id })!;
    const b = s().capture("B", { parentId: a })!;
    s().toggleCollapsed(a, true);
    s().toggleCollapsed(`limb:${limb.id}`, true);
    s().select(b);
    const rows = outline(s().thoughts, Object.values(s().limbs), s().collapsed, true);
    expect(rows.some((r) => r.kind === "thought" && r.thought.id === b)).toBe(true);
  });
});

describe("limbs", () => {
  it("reorders limbs", () => {
    const a = s().addLimb("A");
    s().addLimb("B");
    const c = s().addLimb("C");
    const names = () =>
      Object.values(s().limbs)
        .sort((x, y) => x.order - y.order)
        .map((l) => l.name);
    s().reorderLimb(c.id, a.id);
    expect(names()).toEqual(["C", "A", "B"]);
    s().reorderLimb(c.id, null);
    expect(names()).toEqual(["A", "B", "C"]);
    s().reorderLimb(a.id, c.id);
    expect(names()).toEqual(["B", "A", "C"]);
  });
});

describe("tidy on the store", () => {
  it("merges a second copy of a limb and its thoughts, and tombstones the extras", () => {
    const a = s().addLimb("Work");
    const b = s().addLimb("work");
    const t1 = s().capture("Ship it", { limbId: a.id })!;
    const t2 = s().capture("Ship it", { limbId: b.id })!;
    s().capture("Only in copy", { parentId: t2 });
    expect(s().tidyUp()).toBe(true);
    const limbs = Object.values(s().limbs).filter((l) => l.name.toLowerCase() === "work");
    expect(limbs).toHaveLength(1);
    const ships = Object.values(s().thoughts).filter((t) => t.title === "Ship it");
    expect(ships).toHaveLength(1);
    expect(kids(ships[0].id)).toEqual(["Only in copy"]);
    const gone = [t1, t2].find((id) => id !== ships[0].id)!;
    expect(s().tombstones[gone]).toBeGreaterThan(0);
    expect(s().tidyUp()).toBe(false);
  });
});
