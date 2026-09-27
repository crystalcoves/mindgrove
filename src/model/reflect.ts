import type { Limb, Thought } from "./types";
import { ancestors } from "./tree";

/*
 * Daily reflection: one gentle question a day (the same one all day, on every
 * device), and a look back at what grew this week.
 */

export const PROMPTS = [
  "What's one thing that went well today?",
  "What's taking up the most space in your head right now?",
  "What did you learn today, even something small?",
  "What are you looking forward to?",
  "What drained your energy today, and what gave you energy?",
  "What's one thing you'd do differently if you could redo today?",
  "Who made a difference to your day?",
  "What are you avoiding, and why?",
  "What's something you're grateful for right now?",
  "What would make tomorrow a good day?",
  "What decision is waiting on you?",
  "What surprised you recently?",
  "Where did you spend your time today, and was it where you wanted?",
  "What's a worry you can let go of?",
  "What's one small win from this week?",
  "What idea keeps coming back to you?",
  "What does 'enough' look like for you this week?",
  "What would you tell yourself from a month ago?",
  "What's one thing you want to remember about today?",
  "What are you proud of lately?",
  "What's a question you can't stop thinking about?",
  "Where did you feel most like yourself today?",
  "What's one habit you want to grow, and one to prune?",
  "What conversation do you need to have?",
  "What felt easy today? What felt hard?",
  "What's on your mind as you start today?",
  "What would you do with a free afternoon right now?",
  "What have you been putting off that would take ten minutes?",
] as const;

const DAY = 86400e3;

/** Local calendar day number, so the prompt changes at local midnight. */
export const dayNumber = (d: Date) => Math.floor((d.getTime() - d.getTimezoneOffset() * 60e3) / DAY);

export const promptFor = (d: Date) => PROMPTS[((dayNumber(d) % PROMPTS.length) + PROMPTS.length) % PROMPTS.length];

/** Title for a reflection: the answer's first line, kept short; the full answer goes in the notes when it's longer. */
export function reflectionFields(question: string, answer: string): { title: string; body: string } {
  const text = answer.trim();
  const first = text.split(/\n/)[0].trim();
  const title = first.length > 90 ? `${first.slice(0, 87).replace(/\s+\S*$/, "")}…` : first;
  const rest = title === text ? "" : `\n\n${text}`;
  return { title, body: `*${question}*${rest}` };
}

export interface WeekSummary {
  planted: number;
  voiceNotes: number;
  reflections: number;
  blooming: number; // became or stayed blooming and was worked on this week
  byLimb: { id: string | null; name: string; color: string; count: number }[];
  highlights: Thought[]; // newest top-level thoughts from the week
}

export function weekSummary(thoughts: Record<string, Thought>, limbs: Record<string, Limb>, now = Date.now()): WeekSummary {
  const since = now - 7 * DAY;
  const all = Object.values(thoughts);
  const fresh = all.filter((t) => t.createdAt >= since);
  const counts = new Map<string | null, number>();
  for (const t of fresh) {
    const root = ancestors(thoughts, t.id)[0] ?? t;
    const limbId = root.limbId && limbs[root.limbId] ? root.limbId : null;
    counts.set(limbId, (counts.get(limbId) ?? 0) + 1);
  }
  const byLimb = [...counts.entries()]
    .map(([id, count]) => ({ id, name: id ? limbs[id].name : "Seeds", color: id ? limbs[id].color : "#9fb4c2", count }))
    .sort((a, b) => b.count - a.count);
  const highlights = fresh
    .filter((t) => !t.parentId || !fresh.some((p) => p.id === t.parentId))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 6);
  return {
    planted: fresh.length,
    voiceNotes: fresh.filter((t) => t.tags.includes("voice") && /^\*Voice note ·/.test(t.body)).length,
    reflections: fresh.filter((t) => t.tags.includes("reflection")).length,
    blooming: all.filter((t) => t.status === "blooming" && t.updatedAt >= since).length,
    byLimb,
    highlights,
  };
}
