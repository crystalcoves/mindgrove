import { useEffect, useMemo } from "react";
import { relTime } from "../lib/keys";
import { ancestors, isWilting } from "../model/tree";
import { STATUS_META } from "../model/types";
import { truncate, useStore } from "../store/store";
import { STATUS_COLORS } from "./themes";

const NUDGE_KEY = "mindgrove:lastTendNudge";
const DAY = 24 * 60 * 60 * 1000;

/** Wilting reminders: a list of stale thoughts with one-tap revive / park / prune. */
export function Tend() {
  const open = useStore((s) => s.tendOpen);
  useWiltNudge();
  if (!open) return null;
  return <TendPanel />;
}

function TendPanel() {
  const thoughts = useStore((s) => s.thoughts);
  const limbs = useStore((s) => s.limbs);
  const wiltWeeks = useStore((s) => s.settings.wiltWeeks);
  const st = useStore.getState;
  const close = () => st().openTend(false);

  // Keep the list stable while tending, so rows don't jump as they're handled.
  const ids = useMemo(() => {
    const now = Date.now();
    return Object.values(useStore.getState().thoughts)
      .filter((t) => isWilting(t, now, useStore.getState().settings.wiltWeeks))
      .sort((a, b) => a.touchedAt - b.touchedAt)
      .map((t) => t.id);
  }, []);

  const now = Date.now();
  const left = ids.filter((id) => thoughts[id] && isWilting(thoughts[id], now, wiltWeeks)).length;

  return (
    <div
      className="scrim fade"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
      onKeyDown={(e) => e.key === "Escape" && close()}
    >
      <div className="settings tend panel in" role="dialog" aria-label="Tend wilting thoughts">
        <div className="s-head">
          <div className="label amber">Tend the grove · {left} wilting</div>
          <button className="icon-btn" onClick={close} aria-label="Close" autoFocus>
            ✕
          </button>
        </div>
        <div className="s-body">
          {ids.length === 0 && <div className="d-empty">Nothing is wilting. Everything's been tended recently. ✿</div>}
          <div className="list">
            {ids.map((id) => {
              const t = thoughts[id];
              if (!t) return null;
              const done = !isWilting(t, now, wiltWeeks);
              const chain = ancestors(thoughts, t.id);
              const root = chain[0] ?? t;
              const limb = root.limbId ? limbs[root.limbId] : null;
              return (
                <div key={id} className={`list-item tend-row${done ? " done" : ""}`}>
                  <span className="status" style={{ "--sc": STATUS_COLORS[t.status] } as React.CSSProperties}>
                    {STATUS_META[t.status].glyph}
                  </span>
                  <span
                    className="grow"
                    onClick={() => {
                      close();
                      st().select(t.id, { open: true });
                    }}
                  >
                    {t.title || "untitled"}
                    <small className="crumb" style={{ display: "block" }}>
                      {[limb?.name ?? "Seeds", ...chain.map((a) => truncate(a.title, 20))].join(" › ")} · untouched {relTime(t.touchedAt)}
                    </small>
                  </span>
                  {done ? (
                    <span className="mono dim" style={{ fontSize: 11 }}>
                      {t.status === "pruned" ? "pruned" : t.status === "dormant" ? "parked" : "revived"} ✓
                    </span>
                  ) : (
                    <span className="tend-acts">
                      <button className="btn small" onClick={() => st().touch(t.id)} title="Keep it growing">
                        Revive
                      </button>
                      <button className="btn ghost small" onClick={() => st().setStatus(t.id, "dormant")} title="Park it on purpose">
                        Park
                      </button>
                      <button className="btn ghost small" onClick={() => st().setStatus(t.id, "pruned")} title="Let it go">
                        Prune
                      </button>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <small className="dim">
            Thoughts wilt after {wiltWeeks} week{wiltWeeks > 1 ? "s" : ""} untouched (change it in Settings). Blooming, dormant and pruned
            thoughts never wilt.
          </small>
        </div>
      </div>
    </div>
  );
}

/** At most once a day, mention wilting thoughts when the app opens. */
function useWiltNudge() {
  const ready = useStore((s) => s.ready);
  useEffect(() => {
    if (!ready) return;
    const st = useStore.getState();
    const now = Date.now();
    let last = 0;
    try {
      last = Number(localStorage.getItem(NUDGE_KEY)) || 0;
    } catch {
      /* storage blocked */
    }
    if (now - last < DAY) return;
    const n = Object.values(st.thoughts).filter((t) => isWilting(t, now, st.settings.wiltWeeks)).length;
    if (!n) return;
    try {
      localStorage.setItem(NUDGE_KEY, String(now));
    } catch {
      /* storage blocked */
    }
    const timer = setTimeout(
      () => st.toast(`${n} thought${n > 1 ? "s are" : " is"} wilting`, { label: "Tend", run: () => useStore.getState().openTend(true) }),
      1200,
    );
    return () => clearTimeout(timer);
  }, [ready]);
}
