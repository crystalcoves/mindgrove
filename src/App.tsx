import { lazy, Suspense, useEffect } from "react";
import { Grove } from "./grove/Grove";
import { useStore } from "./store/store";
import { Capture } from "./ui/Capture";
import { Detail } from "./ui/Detail";
import { Hud } from "./ui/Hud";
import { Palette } from "./ui/Palette";
import { SettingsPanel } from "./ui/SettingsPanel";
import { THEMES } from "./ui/themes";
import { useHotkeys } from "./ui/useHotkeys";

// three.js only loads when the canopy is first opened, keeping the Grove instant.
const Canopy = lazy(() => import("./canopy/Canopy"));

export default function App() {
  const ready = useStore((s) => s.ready);
  const view = useStore((s) => s.view);
  const theme = useStore((s) => s.settings.theme);
  const reduced = useStore((s) => s.settings.reducedMotion);
  useHotkeys();

  useEffect(() => {
    void useStore.getState().init();
  }, []);

  useEffect(() => {
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEMES[theme].css["--bg0"]);
  }, [theme]);

  return (
    <div className={`app theme-${theme}${reduced ? " reduced-motion" : ""}`} style={THEMES[theme].css as React.CSSProperties}>
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
