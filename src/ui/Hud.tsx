import { useMemo } from "react";
import { isUnplaced, isWilting } from "../model/tree";
import { MOD } from "../lib/keys";
import { useStore } from "../store/store";
import { SyncChip } from "./SyncSection";

export function Hud() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const query = useStore((s) => s.filters.query);
  const setFilters = useStore((s) => s.setFilters);
  const thoughts = useStore((s) => s.thoughts);
  const wiltWeeks = useStore((s) => s.settings.wiltWeeks);
  const st = useStore.getState;

  const stats = useMemo(() => {
    const now = Date.now();
    let total = 0,
      blooming = 0,
      seeds = 0,
      wilting = 0;
    for (const t of Object.values(thoughts)) {
      if (t.status === "pruned") continue;
      total++;
      if (t.status === "blooming") blooming++;
      if (isUnplaced(t)) seeds++;
      if (isWilting(t, now, wiltWeeks)) wilting++;
    }
    return { total, blooming, seeds, wilting };
  }, [thoughts, wiltWeeks]);

  return (
    <header className="hud">
      <div className="brand" aria-label="Mindgrove">
        <svg width="22" height="22" viewBox="0 0 64 64" aria-hidden>
          <g fill="none" stroke="var(--accent)" strokeWidth="4" strokeLinecap="round">
            <path d="M32 58V30M32 40 19 27M32 35l13-13M32 30V12" />
          </g>
          <g fill="var(--primary)">
            <circle cx="32" cy="10" r="5" />
            <circle cx="17" cy="25" r="4" />
            <circle cx="47" cy="20" r="4" />
          </g>
        </svg>
        <span>MINDGROVE</span>
      </div>
      <div className="views" role="tablist" aria-label="View">
        <button
          role="tab"
          aria-selected={view === "grove"}
          className={view === "grove" ? "on" : ""}
          onClick={() => setView("grove")}
          title="Outline (V)"
        >
          ☰ GROVE
        </button>
        <button
          role="tab"
          aria-selected={view === "canopy"}
          className={view === "canopy" ? "on" : ""}
          onClick={() => setView("canopy")}
          title="3D tree (V)"
        >
          ◈ CANOPY
        </button>
      </div>
      <div className="search">
        <input
          className="input"
          value={query}
          placeholder="Search thoughts, notes, #tags"
          aria-label="Search"
          onChange={(e) => {
            setFilters({ query: e.target.value });
            if (st().view !== "grove") st().setView("grove");
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setFilters({ query: "" });
              (e.target as HTMLInputElement).blur();
            }
            if (e.key === "ArrowDown" || e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
        {!query && <span className="kbd">{MOD} K</span>}
      </div>
      <div className="stats">
        <button className="stat" onClick={() => st().clearFilters()} title="All living thoughts">
          <b>{stats.total}</b>
          <span>THOUGHTS</span>
        </button>
        <button className="stat hot" onClick={() => st().setFilters({ statuses: ["blooming"] })} title="Became an action / done">
          <b>{stats.blooming}</b>
          <span>BLOOMING</span>
        </button>
        <button
          className="stat"
          onClick={() => {
            st().toggleCollapsed("seeds", false);
            st().setView("grove");
          }}
          title="Unplaced seeds in the inbox"
        >
          <b>{stats.seeds}</b>
          <span>SEEDS</span>
        </button>
        <button className={`stat${stats.wilting ? " warn" : ""}`} onClick={() => st().openTend(true)} title="Untouched for a while">
          <b>{stats.wilting}</b>
          <span>WILTING</span>
        </button>
      </div>
      <div className="hud-actions">
        <SyncChip />
        <button className="btn solid" onClick={() => st().openCapture(true)} title="Capture (/)">
          + CAPTURE
        </button>
        <button className="icon-btn" onClick={() => st().openPalette(true)} title={`Commands (${MOD}+K)`} aria-label="Command palette">
          ⌘
        </button>
        <button className="icon-btn" onClick={() => st().openSettings(true)} title="Settings (?)" aria-label="Settings">
          ⚙
        </button>
      </div>
    </header>
  );
}
