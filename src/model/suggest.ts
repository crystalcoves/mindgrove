import { ancestors, childrenIndex, descendants, effectiveLimb, type ById } from "./tree";
import type { Link, Thought } from "./types";

const STOP = new Set(
  "about above after again also another because been before being below between both could does doing down during each even every from further have having here into just like made make many more most much must need only other over really same should since some still such than that their them then there these they thing things think this those through very want were what when where which while will with would your yours".split(
    " ",
  ),
);

/** Meaningful words of a thought: lowercase, 4+ letters, no stopwords, naive singular. */
export function keywords(t: Pick<Thought, "title" | "body">): Set<string> {
  const out = new Set<string>();
  for (const raw of `${t.title} ${t.body}`.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []) {
    if (STOP.has(raw) || /^\d+$/.test(raw)) continue;
    out.add(raw.length > 4 && raw.endsWith("s") && !raw.endsWith("ss") ? raw.slice(0, -1) : raw);
  }
  return out;
}

export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export interface VineSuggestion {
  thought: Thought;
  score: number;
  reasons: string[];
}

/**
 * Thoughts on *other* limbs that look related to `id`: shared tags count most,
 * shared keywords less. Excludes existing vines, its own line of ancestry and
 * dismissed pairs.
 */
export function suggestVines(thoughts: ById, links: Link[], id: string, dismissed: Record<string, boolean>, limit = 3): VineSuggestion[] {
  const me = thoughts[id];
  if (!me) return [];
  const idx = childrenIndex(thoughts);
  const family = new Set([id, ...ancestors(thoughts, id).map((t) => t.id), ...descendants(idx, id).map((t) => t.id)]);
  const linked = new Set(links.flatMap((l) => (l.from === id ? [l.to] : l.to === id ? [l.from] : [])));
  const myLimb = effectiveLimb(thoughts, id);
  const myWords = keywords(me);
  const myTags = new Set(me.tags);

  const out: VineSuggestion[] = [];
  for (const t of Object.values(thoughts)) {
    if (family.has(t.id) || linked.has(t.id) || t.status === "pruned" || dismissed[pairKey(id, t.id)]) continue;
    const limb = effectiveLimb(thoughts, t.id);
    if (myLimb && limb === myLimb) continue; // vines cross between limbs
    const tags = t.tags.filter((x) => myTags.has(x));
    const words = [...keywords(t)].filter((w) => myWords.has(w));
    const score = tags.length * 3 + words.length;
    if (score < 2) continue;
    out.push({ thought: t, score, reasons: [...tags.map((x) => `#${x}`), ...words.slice(0, 3)] });
  }
  return out.sort((a, b) => b.score - a.score || b.thought.touchedAt - a.thought.touchedAt).slice(0, limit);
}
