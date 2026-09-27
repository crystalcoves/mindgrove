import { describe, expect, it } from "vitest";
import type { Thought } from "./types";
import { keywords, pairKey, suggestVines } from "./suggest";

const t = (id: string, title: string, o: Partial<Thought> = {}): Thought => ({
  id,
  title,
  parentId: null,
  limbId: null,
  body: "",
  status: "growing",
  tags: [],
  order: 0,
  createdAt: 0,
  updatedAt: 0,
  touchedAt: 0,
  ...o,
});
const byId = (ts: Thought[]) => Object.fromEntries(ts.map((x) => [x.id, x]));

describe("vine suggestions", () => {
  const ts = byId([
    t("a", "Morning running habit", { limbId: "life", tags: ["health"] }),
    t("b", "Track running pace in a spreadsheet", { limbId: "work" }),
    t("c", "Team health check survey", { limbId: "work", tags: ["health"] }),
    t("d", "Running shoes", { parentId: "a" }),
    t("e", "Buy running gear before the habit fades", { limbId: "life" }),
    t("f", "Unrelated thing", { limbId: "ideas" }),
  ]);

  it("finds related thoughts on other limbs, tags first", () => {
    const s = suggestVines(ts, [], "a", {});
    expect(s.map((x) => x.thought.id)).toEqual(["c"]);
    expect(s[0].reasons).toContain("#health");
  });

  it("scores keyword overlap and skips own limb, family and existing vines", () => {
    const withWords = { ...ts, b: { ...ts.b, title: "Running habit tracker" } };
    const s = suggestVines(withWords, [{ id: "l", from: "c", to: "a" }], "a", {});
    expect(s.map((x) => x.thought.id)).toEqual(["b"]);
  });

  it("respects dismissed pairs", () => {
    expect(suggestVines(ts, [], "a", { [pairKey("c", "a")]: true })).toEqual([]);
  });

  it("extracts keywords without stopwords", () => {
    expect([...keywords({ title: "Should I think about the Habits", body: "" })]).toEqual(["habit"]);
  });
});
