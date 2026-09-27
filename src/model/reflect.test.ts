import { describe, expect, it } from "vitest";
import type { Limb, Thought } from "./types";
import { PROMPTS, promptFor, reflectionFields, weekSummary } from "./reflect";

const DAY = 86400e3;
const now = Date.UTC(2026, 8, 27, 12);
const t = (id: string, age: number, extra: Partial<Thought> = {}): Thought => ({
  id,
  parentId: null,
  limbId: null,
  title: id,
  body: "",
  status: "seed",
  tags: [],
  order: 0,
  createdAt: now - age * DAY,
  updatedAt: now - age * DAY,
  touchedAt: now - age * DAY,
  ...extra,
});

describe("reflection prompts", () => {
  it("gives one prompt per day and moves on the next day", () => {
    const d = new Date(2026, 8, 27, 8);
    expect(promptFor(d)).toBe(promptFor(new Date(2026, 8, 27, 22)));
    expect(promptFor(d)).not.toBe(promptFor(new Date(2026, 8, 28, 8)));
    expect(PROMPTS).toContain(promptFor(d));
  });

  it("keeps short answers as the title and long ones in the notes", () => {
    expect(reflectionFields("Q?", "A good walk")).toEqual({ title: "A good walk", body: "*Q?*" });
    const long = reflectionFields("Q?", "First line\nand more detail");
    expect(long.title).toBe("First line");
    expect(long.body).toContain("and more detail");
    expect(reflectionFields("Q?", "word ".repeat(40)).title.length).toBeLessThanOrEqual(90);
  });
});

describe("weekSummary", () => {
  it("counts this week's growth by limb", () => {
    const limbs: Record<string, Limb> = { w: { id: "w", name: "Work", color: "#fff", order: 0, createdAt: 0 } };
    const ts = [
      t("a", 1, { limbId: "w" }),
      t("b", 2, { parentId: "a" }),
      t("c", 3, { tags: ["reflection"] }),
      t("v", 1, { tags: ["voice"], body: "*Voice note · 1:00*" }),
      t("old", 20, { status: "blooming", updatedAt: now - DAY }),
    ];
    const s = weekSummary(Object.fromEntries(ts.map((x) => [x.id, x])), limbs, now);
    expect(s.planted).toBe(4);
    expect(s.reflections).toBe(1);
    expect(s.voiceNotes).toBe(1);
    expect(s.blooming).toBe(1);
    expect(s.byLimb[0]).toMatchObject({ name: "Work", count: 2 });
    expect(s.highlights.map((h) => h.id)).not.toContain("b");
  });
});
