import { downloadBackup, downloadMarkdown, readImport } from "../io/files";
import { MOD } from "../lib/keys";
import { byOrder } from "../model/tree";
import type { ParticleLevel, ThemeName } from "../model/types";
import { useStore } from "../store/store";
import { THEMES } from "./themes";
import { SyncSection } from "./SyncSection";
import { audioStore } from "../db/db";
import { useEffect, useState } from "react";

/** Open a file picker and import. `merge` keeps existing thoughts; `replace` restores a backup. */
export function pickImport(mode: "merge" | "replace") {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.accept = ".json,.md,.markdown,.txt,.zip";
  input.onchange = async () => {
    const files = [...(input.files ?? [])];
    if (!files.length) return;
    const st = useStore.getState();
    try {
      const { snapshot } = await readImport(files);
      const n = snapshot.thoughts.length;
      if (mode === "replace") {
        if (!confirm(`Replace your whole grove with ${n} thoughts from this file? Export a backup first if unsure.`)) return;
        st.replaceAll(snapshot);
        st.toast(`Restored ${n} thoughts`);
      } else {
        st.merge(snapshot);
        st.toast(`Imported ${n} thoughts · ${snapshot.limbs.length} limbs`);
      }
    } catch (err) {
      st.toast(`Import failed: ${(err as Error).message}`);
    }
  };
  input.click();
}

const KEYS: [string, string[]][] = [
  ["Capture a thought", ["/"]],
  ["Capture (anywhere)", [MOD, "Space"]],
  ["Command palette", [MOD, "K"]],
  ["Grove ⇄ Canopy", ["V"]],
  ["Tend wilting thoughts", ["W"]],
  ["Move selection", ["↑", "↓"]],
  ["Fold / unfold · parent", ["←", "→"]],
  ["Edit title", ["Enter"]],
  ["Open details", ["Space"]],
  ["New thought below", ["O"]],
  ["New follow-up", ["N"]],
  ["Nest under previous", ["Tab"]],
  ["Lift out a level", ["Shift", "Tab"]],
  ["Reorder", ["Alt", "↑/↓"]],
  ["Cycle status", ["S"]],
  ["Prune / unprune", ["X"]],
  ["Move to…", ["M"]],
  ["Grow a vine", ["L"]],
  ["Remove (undo-able)", ["Del"]],
  ["Clear / close / deselect", ["Esc"]],
];

export function SettingsPanel() {
  const open = useStore((s) => s.settingsOpen);
  const settings = useStore((s) => s.settings);
  const limbs = useStore((s) => s.limbs);
  if (!open) return null;
  const st = useStore.getState;
  const close = () => st().openSettings(false);

  return (
    <div
      className="scrim fade"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
      onKeyDown={(e) => e.key === "Escape" && close()}
    >
      <div className="settings panel in" role="dialog" aria-label="Settings">
        <div className="s-head">
          <div className="label amber">Settings</div>
          <button className="icon-btn" onClick={close} aria-label="Close settings" autoFocus>
            ✕
          </button>
        </div>
        <div className="s-body">
          <section className="d-sec">
            <div className="label">Theme</div>
            <div className="themes">
              {(Object.keys(THEMES) as ThemeName[]).map((k) => {
                const t = THEMES[k];
                return (
                  <button
                    key={k}
                    className={`theme-card${settings.theme === k ? " on" : ""}`}
                    onClick={() => st().setSettings({ theme: k })}
                    aria-pressed={settings.theme === k}
                  >
                    <span className="sw">
                      {[t.css["--accent"], t.css["--primary"], t.scene.vine, t.scene.bg].map((c, i) => (
                        <i key={i} style={{ background: c, boxShadow: `0 0 8px ${c}` }} />
                      ))}
                    </span>
                    <b style={{ color: t.css["--primary"] }}>{t.label}</b>
                    <small>{t.blurb}</small>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="d-sec">
            <div className="label">Motion & effects</div>
            <div className="s-grid">
              <label className="field">
                <span>
                  Reduced motion<small>No growth animation, drift or camera sweeps</small>
                </span>
                <button
                  className={`toggle${settings.reducedMotion ? " on" : ""}`}
                  role="switch"
                  aria-checked={settings.reducedMotion}
                  onClick={() => st().setSettings({ reducedMotion: !settings.reducedMotion })}
                />
              </label>
              <label className="field">
                <span>
                  Particles<small>Canopy spores and capture bursts</small>
                </span>
                <select
                  className="input"
                  style={{ width: 110 }}
                  value={settings.particles}
                  onChange={(e) => st().setSettings({ particles: e.target.value as ParticleLevel })}
                >
                  <option value="high">High</option>
                  <option value="low">Low</option>
                  <option value="off">Off</option>
                </select>
              </label>
              <label className="field">
                <span>
                  Daily reflection<small>One question a day when you open the app</small>
                </span>
                <button
                  className={`toggle${settings.reflectDaily ? " on" : ""}`}
                  role="switch"
                  aria-checked={settings.reflectDaily}
                  onClick={() => st().setSettings({ reflectDaily: !settings.reflectDaily })}
                />
              </label>
              <label className="field">
                <span>
                  Wilt after<small>Weeks untouched before a thought fades</small>
                </span>
                <select
                  className="input"
                  style={{ width: 110 }}
                  value={settings.wiltWeeks}
                  onChange={(e) => st().setSettings({ wiltWeeks: Number(e.target.value) })}
                >
                  {[1, 2, 3, 4, 6, 8, 12].map((w) => (
                    <option key={w} value={w}>
                      {w} week{w > 1 ? "s" : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          <section className="d-sec">
            <div className="label">Limbs</div>
            <div className="limbs-edit">
              {Object.values(limbs)
                .sort(byOrder)
                .map((l, i, all) => (
                  <div key={l.id} className="limb-row">
                    <button
                      className="icon-btn"
                      disabled={i === 0}
                      onClick={() => st().reorderLimb(l.id, all[i - 1].id)}
                      aria-label={`Move ${l.name} up`}
                    >
                      ↑
                    </button>
                    <button
                      className="icon-btn"
                      disabled={i === all.length - 1}
                      onClick={() => st().reorderLimb(l.id, all[i + 2]?.id ?? null)}
                      aria-label={`Move ${l.name} down`}
                    >
                      ↓
                    </button>
                    <input
                      type="color"
                      value={l.color}
                      onChange={(e) => st().updateLimb(l.id, { color: e.target.value })}
                      aria-label={`${l.name} colour`}
                    />
                    <input
                      className="input"
                      defaultValue={l.name}
                      onBlur={(e) => e.target.value.trim() && st().updateLimb(l.id, { name: e.target.value.trim() })}
                      aria-label="Limb name"
                    />
                    <button
                      className="btn danger small"
                      onClick={() => confirm(`Remove limb “${l.name}”? Its branches go back to the seed inbox.`) && st().removeLimb(l.id)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              <div>
                <button
                  className="btn small"
                  onClick={() => {
                    const name = prompt("Name the new limb (a theme or domain)");
                    if (name?.trim()) st().addLimb(name.trim());
                  }}
                >
                  + New limb
                </button>
              </div>
            </div>
          </section>

          <SyncSection />

          <section className="d-sec">
            <div className="label">Your data · stored only in this browser</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button className="btn solid" onClick={() => downloadMarkdown(st().snapshot())}>
                ⇩ Markdown .zip
              </button>
              <button className="btn" onClick={() => downloadBackup(st().snapshot(), st().settings)}>
                ⇩ JSON backup
              </button>
              <button className="btn" onClick={() => pickImport("merge")}>
                ⇧ Import (merge)
              </button>
              <button className="btn danger" onClick={() => pickImport("replace")}>
                ⟲ Restore backup (replace)
              </button>
            </div>
            <small className="dim">
              Markdown export writes one file per limb plus Seeds.md — readable in any editor, and importable back without loss.
            </small>
            <SavedAudio />
          </section>

          <section className="d-sec">
            <div className="label">Keyboard</div>
            <div className="keys">
              {KEYS.map(([what, keys]) => (
                <div key={what}>
                  <span>{what}</span>
                  <span>
                    {keys.map((k) => (
                      <kbd key={k}>{k}</kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/** Voice-note recordings kept on this device for playback. */
function SavedAudio() {
  const [usage, setUsage] = useState<{ bytes: number; count: number } | null>(null);
  useEffect(() => {
    void audioStore.usage().then(setUsage, () => setUsage(null));
  }, []);
  if (!usage?.count) return null;
  return (
    <div className="sync-row">
      <small className="dim">
        {usage.count} voice-note recording{usage.count > 1 ? "s" : ""} kept on this device for playback ·{" "}
        {(usage.bytes / 1024 / 1024).toFixed(1)} MB (not synced or exported)
      </small>
      <button
        className="btn ghost small"
        onClick={() =>
          confirm("Delete the saved recordings? Transcripts stay; only playback goes.") &&
          void audioStore.clear().then(() => setUsage({ bytes: 0, count: 0 }))
        }
      >
        Delete recordings
      </button>
    </div>
  );
}
