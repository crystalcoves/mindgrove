import { describe, expect, it } from "vitest";
import { demoSnapshot } from "../store/demo";
import type { Snapshot } from "../model/types";
import { exportMarkdown, importMarkdown } from "./markdown";
import { parseBackup, toBackup, unzip, zip } from "./files";

const norm = (s: Snapshot) => ({
  thoughts: [...s.thoughts].sort((a, b) => a.id.localeCompare(b.id)).map((t) => ({ ...t, order: undefined })),
  limbs: [...s.limbs].sort((a, b) => a.id.localeCompare(b.id)),
  links: [...s.links].sort((a, b) => a.id.localeCompare(b.id)),
});

/** Sibling order as a list of ids per parent — the only thing `order` means. */
const orderings = (s: Snapshot) => {
  const m: Record<string, string[]> = {};
  for (const t of [...s.thoughts].sort((a, b) => a.order - b.order)) (m[t.parentId ?? `l:${t.limbId}`] ??= []).push(t.id);
  return m;
};

describe("markdown export", () => {
  const snap = demoSnapshot(1_700_000_000_000);
  // Awkward content that must survive.
  snap.thoughts[0].title = "Use `code` and #not-a-tag in a title";
  snap.thoughts[0].body = "Line one\n\n- a list\n> a quote\n  indented";
  snap.thoughts[1].title = "";

  it("writes one file per limb plus Seeds.md", () => {
    const files = exportMarkdown(snap);
    expect(files.map((f) => f.name)).toEqual(["Seeds.md", "General.md", "Work.md", "Life.md", "Ideas.md"]);
    expect(files[2].content).toContain("- Ship the side project `growing` #goal");
    expect(files[2].content).toContain("  - Pick one feature for v1 `blooming`");
  });

  it("round-trips losslessly through markdown and zip", () => {
    const back = importMarkdown(unzip(zip(exportMarkdown(snap))));
    expect(norm(back)).toEqual(norm(snap));
    expect(orderings(back)).toEqual(orderings(snap));
  });

  it("round-trips through the JSON backup", () => {
    const b = parseBackup(JSON.stringify(toBackup(snap)));
    expect(norm(b)).toEqual(norm(snap));
  });

  it("imports hand-written markdown", () => {
    const s = importMarkdown([
      { name: "Garden.md", content: "# Garden\n\n- Tomatoes `growing` #summer\n  > Stake them early\n  - Buy seeds\n- Compost\n" },
    ]);
    expect(s.limbs.map((l) => l.name)).toEqual(["Garden"]);
    const [tom, buy, comp] = s.thoughts;
    expect(tom).toMatchObject({ title: "Tomatoes", status: "growing", tags: ["summer"], body: "Stake them early", limbId: s.limbs[0].id });
    expect(buy).toMatchObject({ title: "Buy seeds", parentId: tom.id, limbId: null });
    expect(comp).toMatchObject({ title: "Compost", parentId: null });
  });

  it("rejects files that are not backups", () => {
    expect(() => parseBackup('{"hello":1}')).toThrow();
  });
});
