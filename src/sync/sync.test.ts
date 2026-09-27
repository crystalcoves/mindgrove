// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Thought } from "../model/types";
import { decryptJSON, deriveKeys, encryptJSON, isValidCode, newSyncCode, normalizeCode } from "./crypto";
import { docSignature, emptyDoc, mergeDocs, type SyncDoc } from "./merge";

const t = (id: string, updatedAt: number, o: Partial<Thought> = {}): Thought => ({
  id,
  title: id,
  parentId: null,
  limbId: null,
  body: "",
  status: "seed",
  tags: [],
  order: 0,
  createdAt: 1,
  updatedAt,
  touchedAt: updatedAt,
  ...o,
});
const doc = (p: Partial<SyncDoc>): SyncDoc => ({ ...emptyDoc(), ...p });
const NOW = 1_000;

describe("sync merge", () => {
  it("keeps the newest version of each record and unions the rest", () => {
    const m = mergeDocs(
      doc({ thoughts: [t("a", 10, { title: "local" }), t("b", 5)] }),
      doc({ thoughts: [t("a", 20, { title: "remote" }), t("c", 7)] }),
      NOW,
    );
    expect(Object.fromEntries(m.thoughts.map((x) => [x.id, x.title]))).toEqual({ a: "remote", b: "b", c: "c" });
  });

  it("a touch (revive) on another device wins over an older edit", () => {
    const m = mergeDocs(doc({ thoughts: [t("a", 10)] }), doc({ thoughts: [{ ...t("a", 10), touchedAt: 30 }] }), NOW);
    expect(m.thoughts[0].touchedAt).toBe(30);
  });

  it("tombstones delete older versions but not newer edits", () => {
    const m = mergeDocs(doc({ thoughts: [t("a", 10), t("b", 50)] }), doc({ tombstones: { a: 20, b: 20 } }), NOW);
    expect(m.thoughts.map((x) => x.id)).toEqual(["b"]);
    expect(m.tombstones).toEqual({ a: 20, b: 20 });
  });

  it("repairs orphans, drops dangling links and breaks cycles", () => {
    const m = mergeDocs(
      doc({
        thoughts: [
          t("kid", 5, { parentId: "gone" }),
          t("x", 5, { parentId: "y" }),
          t("y", 6, { parentId: "x" }),
          t("r", 5, { limbId: "L" }),
        ],
        links: [{ id: "l1", from: "kid", to: "gone", createdAt: 5 }],
      }),
      doc({ tombstones: { gone: 9 } }),
      NOW,
    );
    const by = Object.fromEntries(m.thoughts.map((x) => [x.id, x]));
    expect(by.kid.parentId).toBeNull();
    expect(by.r.limbId).toBeNull();
    expect(m.links).toEqual([]);
    expect([by.x.parentId, by.y.parentId].filter(Boolean)).toHaveLength(1);
  });

  it("is order-independent and idempotent", () => {
    const a = doc({ thoughts: [t("a", 10), t("b", 3)], tombstones: { z: 4 } });
    const b = doc({ thoughts: [t("a", 12), t("c", 3)], tombstones: { b: 5 } });
    const ab = mergeDocs(a, b, NOW);
    expect(docSignature(ab)).toBe(docSignature(mergeDocs(b, a, NOW)));
    expect(docSignature(mergeDocs(ab, b, NOW))).toBe(docSignature(ab));
  });

  it("forgets ancient tombstones", () => {
    expect(mergeDocs(doc({ tombstones: { old: 1 } }), emptyDoc(), 1_800_000_000_000).tombstones).toEqual({});
  });
});

describe("sync crypto", () => {
  it("makes valid, unique codes", () => {
    const a = newSyncCode();
    expect(isValidCode(a)).toBe(true);
    expect(isValidCode(a.toUpperCase().replace(/-/g, " "))).toBe(true);
    expect(newSyncCode()).not.toBe(a);
    expect(isValidCode("nope")).toBe(false);
  });

  it("derives the same id for a retyped code and round-trips encryption", async () => {
    const code = newSyncCode();
    const k1 = await deriveKeys(code);
    const k2 = await deriveKeys(normalizeCode(code).toUpperCase());
    expect(k1.id).toBe(k2.id);
    expect(k1.id).toMatch(/^[0-9a-f]{64}$/);
    const box = await encryptJSON(k1.key, { hello: "grove", n: [1, 2] });
    expect(box).not.toContain("grove");
    expect(await decryptJSON(k2.key, box)).toEqual({ hello: "grove", n: [1, 2] });
    const other = await deriveKeys(newSyncCode());
    await expect(decryptJSON(other.key, box)).rejects.toThrow();
  });
});
