import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import { relTime } from "../lib/keys";
import { dayNumber, promptFor, reflectionFields, weekSummary } from "../model/reflect";
import { REFLECTION_LIMB_ID } from "../model/tidy";
import { truncate, useStore } from "../store/store";
import { useVoice } from "../voice/engine";

/*
 * Daily reflection: once a day, a single question; the answer is planted on the
 * Reflection limb. Plus "What grew this week", a calm look back.
 */

type Mode = "prompt" | "week";
const useReflect = create<{ open: Mode | null }>(() => ({ open: null }));
export const openReflect = (mode: Mode | null) => useReflect.setState({ open: mode });

const DAY_KEY = "mindgrove:reflectDay";
const WEEK_QUESTION = "Looking back at this week, what stands out?";

export function Reflect() {
  const open = useReflect((s) => s.open);
  useDailyPrompt();
  if (!open) return null;
  return <ReflectPanel mode={open} />;
}

/** Offer today's question once a day, when nothing else is on screen. */
function useDailyPrompt() {
  const ready = useStore((s) => s.ready);
  const enabled = useStore((s) => s.settings.reflectDaily);
  useEffect(() => {
    if (!ready || !enabled) return;
    const today = String(dayNumber(new Date()));
    try {
      if (localStorage.getItem(DAY_KEY) === today) return;
    } catch {
      return; // no storage: don't risk asking on every open
    }
    const timer = setTimeout(() => {
      const st = useStore.getState();
      const busy = st.captureOpen || st.settingsOpen || st.tendOpen || st.paletteOpen || st.editingId || useVoice.getState().open;
      if (busy || useReflect.getState().open) return; // try again next time the app opens
      try {
        localStorage.setItem(DAY_KEY, today);
      } catch {
        /* storage blocked */
      }
      openReflect("prompt");
    }, 1500);
    return () => clearTimeout(timer);
  }, [ready, enabled]);
}

function reflectionLimbId(): string {
  const st = useStore.getState();
  const limb =
    st.limbs[REFLECTION_LIMB_ID] ??
    Object.values(st.limbs).find((l) => l.name.trim().toLowerCase() === "reflection") ??
    st.addLimb("Reflection", "#ff6fae");
  return limb.id;
}

function ReflectPanel({ mode }: { mode: Mode }) {
  const close = () => openReflect(null);
  const [asking, setAsking] = useState<string | null>(mode === "prompt" ? promptFor(new Date()) : null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
  return (
    <div
      className="scrim fade"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
      onKeyDown={(e) => e.key === "Escape" && close()}
    >
      <div className="settings reflect panel in" role="dialog" aria-label={asking ? "Daily reflection" : "What grew this week"}>
        <div className="s-head">
          <div className="label amber">
            {asking
              ? `Reflection · ${new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" })}`
              : "What grew this week"}
          </div>
          <button className="icon-btn" onClick={close} aria-label="Close">
            ✕
          </button>
        </div>
        {asking ? (
          <Prompt question={asking} onDone={close} onWeek={() => setAsking(null)} />
        ) : (
          <Week onReflect={() => setAsking(WEEK_QUESTION)} />
        )}
      </div>
    </div>
  );
}

function Prompt({ question, onDone, onWeek }: { question: string; onDone: () => void; onWeek: () => void }) {
  const [answer, setAnswer] = useState("");
  const enabled = useStore((s) => s.settings.reflectDaily);
  const plant = () => {
    if (!answer.trim()) return;
    const st = useStore.getState();
    const t = st.addThought({ ...reflectionFields(question, answer), limbId: reflectionLimbId(), tags: ["reflection"], status: "growing" });
    st.toast("Reflection planted", { label: "Open", run: () => useStore.getState().select(t.id, { open: true }) });
    onDone();
  };
  return (
    <div className="s-body">
      <p className="reflect-q">{question}</p>
      <textarea
        className="input reflect-a"
        autoFocus
        rows={4}
        value={answer}
        placeholder="A line or two is plenty…"
        onChange={(e) => setAnswer(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            plant();
          }
        }}
      />
      <div className="reflect-foot">
        <button className="btn ghost small" onClick={onWeek}>
          What grew this week →
        </button>
        <span style={{ flex: 1 }} />
        <button className="btn ghost" onClick={onDone}>
          Not today
        </button>
        <button className="btn solid" disabled={!answer.trim()} onClick={plant}>
          ✦ Plant in Reflection
        </button>
      </div>
      <small className="dim">
        Enter plants it · Shift+Enter for a new line.{" "}
        {enabled ? (
          <>
            A new question appears once a day;{" "}
            <button className="link-btn" onClick={() => (useStore.getState().setSettings({ reflectDaily: false }), onDone())}>
              turn off the daily prompt
            </button>
          </>
        ) : (
          "The daily prompt is off (Settings); open this any time from the command palette."
        )}
      </small>
    </div>
  );
}

function Week({ onReflect }: { onReflect: () => void }) {
  const thoughts = useStore((s) => s.thoughts);
  const limbs = useStore((s) => s.limbs);
  const w = useMemo(() => weekSummary(thoughts, limbs), [thoughts, limbs]);
  const max = Math.max(1, ...w.byLimb.map((l) => l.count));
  const open = (id: string) => {
    openReflect(null);
    useStore.getState().select(id, { open: true });
  };
  return (
    <div className="s-body">
      <div className="week-stats">
        <Stat n={w.planted} label="planted" />
        <Stat n={w.blooming} label="blooming" />
        <Stat n={w.voiceNotes} label={w.voiceNotes === 1 ? "voice note" : "voice notes"} />
        <Stat n={w.reflections} label={w.reflections === 1 ? "reflection" : "reflections"} />
      </div>
      {w.planted === 0 ? (
        <div className="d-empty">A quiet week. Nothing new was planted in the last 7 days.</div>
      ) : (
        <>
          <div className="week-limbs">
            {w.byLimb.map((l) => (
              <div key={l.id ?? "seeds"} className="week-limb">
                <span>{l.name}</span>
                <i style={{ width: `${(l.count / max) * 100}%`, background: l.color }} />
                <b className="mono">{l.count}</b>
              </div>
            ))}
          </div>
          <div className="label">Newest</div>
          <div className="list">
            {w.highlights.map((t) => (
              <div key={t.id} className="list-item" onClick={() => open(t.id)}>
                <span className="grow">
                  {truncate(t.title || "untitled", 70)}
                  <small className="crumb" style={{ display: "block" }}>
                    {relTime(t.createdAt)} ago
                  </small>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="reflect-foot">
        <span style={{ flex: 1 }} />
        <button className="btn solid" onClick={onReflect}>
          Reflect on the week
        </button>
      </div>
    </div>
  );
}

const Stat = ({ n, label }: { n: number; label: string }) => (
  <div className="week-stat">
    <b className="mono">{n}</b>
    <small>{label}</small>
  </div>
);
