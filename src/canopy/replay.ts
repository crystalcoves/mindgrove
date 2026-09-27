import { create } from "zustand";

/*
 * Growth-ring replay: scrub or play the tree growing from its first thought
 * to today. Read every frame by the scene via getState(), so scrubbing never
 * re-renders React.
 */
interface ReplayState {
  active: boolean;
  playing: boolean;
  t: number;
  from: number;
  to: number;
  /** How long (ms of tree time) a thought takes to grow in once it's born. */
  window: number;
  /** Bumped on every change so the scene knows to redraw. */
  v: number;
}

export const REPLAY_SECONDS = 12;

export const useReplay = create<ReplayState>(() => ({ active: false, playing: false, t: 0, from: 0, to: 0, window: 1, v: 0 }));

const bump = (patch: Partial<ReplayState>) => useReplay.setState((s) => ({ ...patch, v: s.v + 1 }));

export const replay = {
  start(from: number, to: number, play = true) {
    const span = Math.max(1, to - from);
    bump({ active: true, playing: play, from, to, t: play ? from : to, window: Math.max(span * 0.035, 60_000) });
  },
  stop: () => bump({ active: false, playing: false }),
  seek: (t: number) => bump({ t, playing: false }),
  toggle() {
    const s = useReplay.getState();
    if (!s.playing && s.t >= s.to) bump({ t: s.from, playing: true });
    else bump({ playing: !s.playing });
  },
  /** Advance playback by dt seconds of wall time. */
  tick(dt: number) {
    const s = useReplay.getState();
    if (!s.active || !s.playing) return;
    const t = s.t + ((s.to - s.from) / REPLAY_SECONDS) * dt;
    bump(t >= s.to ? { t: s.to, playing: false } : { t });
  },
};

/** 0 → 1 growth of something born at `bornAt` at replay time `t`. */
export function replayGrowth(bornAt: number, t: number, window: number): number {
  if (bornAt <= 0) return 1;
  const g = (t - bornAt) / window;
  return g < 0 ? 0 : g > 1 ? 1 : g;
}
