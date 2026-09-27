import { rng } from "../lib/id";
import type { ById } from "../model/tree";
import type { Limb } from "../model/types";

export type V3 = [number, number, number];

export interface Segment {
  start: V3;
  end: V3;
  /** Unit direction start → end. */
  dir: V3;
  radius: number;
  depth: number;
  /** Limb id this segment belongs to (null for seeds). */
  limbId: string | null;
}

export interface Layout {
  trunk: Segment;
  limbs: Map<string, Segment>;
  nodes: Map<string, Segment>;
}

export const TRUNK_HEIGHT = 6;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/**
 * Procedural, seeded layout. Every segment is a pure function of its own id and
 * its ancestors, never of its siblings, so adding a thought never moves another.
 */
export function layoutTree(thoughts: ById, limbs: Limb[]): Layout {
  const trunk: Segment = seg([0, 0, 0], [0, 1, 0], TRUNK_HEIGHT, 0.34, -1, null);
  const limbSegs = new Map<string, Segment>();
  for (const l of limbs) limbSegs.set(l.id, limbSegment(l));

  const nodes = new Map<string, Segment>();
  const visiting = new Set<string>();

  const place = (id: string): Segment | null => {
    const hit = nodes.get(id);
    if (hit) return hit;
    const t = thoughts[id];
    if (!t || visiting.has(id)) return null;
    visiting.add(id);
    const r = rng(id);
    let s: Segment;
    const parent = t.parentId ? place(t.parentId) : null;
    if (parent) {
      s = branchFrom(parent, r, parent.depth + 1, parent.limbId);
    } else if (t.limbId && limbSegs.has(t.limbId)) {
      s = branchFrom(limbSegs.get(t.limbId)!, r, 0, t.limbId);
    } else {
      s = seedSegment(r);
    }
    visiting.delete(id);
    nodes.set(id, s);
    return s;
  };

  for (const id of Object.keys(thoughts)) place(id);
  return { trunk, limbs: limbSegs, nodes };
}

function limbSegment(l: Limb): Segment {
  const r = rng(l.id);
  const az = l.order * GOLDEN * 1.0 + r() * 0.25;
  const h = 2.4 + ((l.order * 1.37) % 3.2) + r() * 0.3;
  const tilt = 0.55 + r() * 0.35; // radians up from horizontal
  const dir: V3 = [Math.cos(az) * Math.cos(tilt), Math.sin(tilt), Math.sin(az) * Math.cos(tilt)];
  return seg([0, Math.min(h, TRUNK_HEIGHT - 0.4), 0], dir, 3.2 + r() * 0.8, 0.17, -1, l.id);
}

function branchFrom(parent: Segment, r: () => number, depth: number, limbId: string | null): Segment {
  // Fork somewhere along the outer part of the parent.
  const along = 0.6 + r() * 0.4;
  const start = lerp(parent.start, parent.end, along);
  const spread = 0.45 + r() * 0.5;
  const az = r() * Math.PI * 2;
  let dir = rotateAway(parent.dir, spread, az);
  // Trees reach for the light.
  dir = norm(add(dir, [0, 0.35, 0]));
  const len = Math.max(0.55, 2.3 * Math.pow(0.74, depth) * (0.8 + r() * 0.4));
  // Branches are noticeably thicker than the sub-branches that fork off them.
  const radius = depth === 0 ? 0.11 : Math.max(0.018, 0.085 * Math.pow(0.66, depth));
  return seg(start, dir, len, radius, depth, limbId);
}

function seedSegment(r: () => number): Segment {
  const az = r() * Math.PI * 2;
  const rad = 2.6 + r() * 1.8;
  const p: V3 = [Math.cos(az) * rad, 0.25 + r() * 0.5, Math.sin(az) * rad];
  return { start: p, end: p, dir: [0, 1, 0], radius: 0.05, depth: 0, limbId: null };
}

function seg(start: V3, dir: V3, len: number, radius: number, depth: number, limbId: string | null): Segment {
  const d = norm(dir);
  return { start, end: add(start, scale(d, len)), dir: d, radius, depth, limbId };
}

/** Rotate `v` away from itself by `angle`, around an azimuth `az`. */
function rotateAway(v: V3, angle: number, az: number): V3 {
  const helper: V3 = Math.abs(v[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = norm(cross(v, helper));
  const w = cross(v, u);
  const perp = add(scale(u, Math.cos(az)), scale(w, Math.sin(az)));
  return norm(add(scale(v, Math.cos(angle)), scale(perp, Math.sin(angle))));
}

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const lerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
