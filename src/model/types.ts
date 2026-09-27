export const STATUSES = ["seed", "growing", "blooming", "dormant", "pruned"] as const;
export type Status = (typeof STATUSES)[number];

export interface Thought {
  id: string;
  parentId: string | null;
  limbId: string | null;
  title: string;
  /** Markdown body. */
  body: string;
  status: Status;
  tags: string[];
  /** Sibling order (ascending). Fractional values allowed for cheap inserts. */
  order: number;
  createdAt: number;
  updatedAt: number;
  /** Last time the thought was opened or edited; drives wilting. */
  touchedAt: number;
}

export interface Link {
  id: string;
  from: string;
  to: string;
}

export interface Limb {
  id: string;
  name: string;
  color: string;
  order: number;
  createdAt: number;
}

export type ThemeName = "holo" | "biolume" | "aurora";
export type ParticleLevel = "high" | "low" | "off";

export interface Settings {
  theme: ThemeName;
  reducedMotion: boolean;
  particles: ParticleLevel;
  /** A thought wilts after this many weeks untouched. */
  wiltWeeks: number;
}

export interface Snapshot {
  thoughts: Thought[];
  limbs: Limb[];
  links: Link[];
}

export const STATUS_META: Record<Status, { label: string; glyph: string; hint: string }> = {
  seed: { label: "Seed", glyph: "◦", hint: "Captured, not yet worked on" },
  growing: { label: "Growing", glyph: "↟", hint: "Actively thinking about it" },
  blooming: { label: "Blooming", glyph: "✿", hint: "Became an action / done" },
  dormant: { label: "Dormant", glyph: "☾", hint: "Parked on purpose" },
  pruned: { label: "Pruned", glyph: "✂", hint: "Let go — kept for history" },
};
