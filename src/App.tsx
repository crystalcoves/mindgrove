import { lazy, Suspense, useEffect } from "react";
import { Grove } from "./grove/Grove";
import { useStore } from "./store/store";
import { Capture } from "./ui/Capture";
import { Detail } from "./ui/Detail";
import { Hud } from "./ui/Hud";
import { Palette } from "./ui/Palette";
import { SettingsPanel } from "./ui/SettingsPanel";
import { Tend } from "./ui/Tend";
import { VoiceNote, isAudioFile, startVoiceNote } from "./ui/VoiceNote";
import { THEMES } from "./ui/themes";
import { useHotkeys } from "./ui/useHotkeys";
import { shareToText } from "./lib/share";
import { bootSync } from "./sync/engine";
import { watchOtherTabs } from "./sync/tabs";

// three.js only loads when the canopy is first opened, keeping the Grove instant.
const Canopy = lazy(() => import("./canopy/Canopy"));

export default function App() {
  const ready = useStore((s) => s.ready);
  const view = useStore((s) => s.view);
  const theme = useStore((s) => s.settings.theme);
  const reduced = useStore((s) => s.settings.reducedMotion);
  useHotkeys();

  useEffect(() => {
    void useStore
      .getState()
      .init()
      .then(() => {
        receiveShare();
        watchOtherTabs();
        void bootSync();
      });
  }, []);

  // Drop an audio file anywhere to transcribe it into thoughts.
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      const f = [...(e.dataTransfer?.files ?? [])].find(isAudioFile);
      if (!f) return;
      e.preventDefault();
      startVoiceNote(f);
    };
    addEventListener("dragover", over);
    addEventListener("drop", drop);
    return () => {
      removeEventListener("dragover", over);
      removeEventListener("drop", drop);
    };
  }, []);

  useEffect(() => {
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEMES[theme].css["--bg0"]);
  }, [theme]);

  return (
    <div className={`app theme-${theme} view-${view}${reduced ? " reduced-motion" : ""}`} style={THEMES[theme].css as React.CSSProperties}>
      <Hud />
      <main className="main">
        <div className="stage">
          {!ready ? (
            <div className="c-loading">GROWING…</div>
          ) : view === "grove" ? (
            <Grove />
          ) : (
            <Suspense fallback={<div className="c-loading">GROWING THE CANOPY…</div>}>
              <Canopy />
            </Suspense>
          )}
        </div>
        <Detail floating={view === "canopy"} />
      </main>
      <button className="fab" onClick={() => useStore.getState().openCapture(true)} aria-label="Capture a thought">
        +
      </button>
      <Capture />
      <Palette />
      <SettingsPanel />
      <Tend />
      <VoiceNote />
      <Toasts />
    </div>
  );
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast panel in">
          <span>{t.text}</span>
          {t.action && (
            <button
              className="btn small solid"
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/** Handle "Share → Mindgrove" (PWA share target): drop it in as a seed, then clean the URL. */
function receiveShare() {
  const params = new URLSearchParams(location.search);
  const text = shareToText(params);
  if (!text) return;
  history.replaceState(null, "", location.pathname);
  const st = useStore.getState();
  const id = st.capture(text);
  if (id) st.toast("Shared into your seeds", { label: "Open", run: () => useStore.getState().select(id, { open: true }) });
}
