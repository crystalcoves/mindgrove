import { lazy, Suspense, useEffect } from "react";
import { Grove } from "./grove/Grove";
import { useStore } from "./store/store";
import { Capture } from "./ui/Capture";
import { Detail } from "./ui/Detail";
import { Hud } from "./ui/Hud";
import { Palette } from "./ui/Palette";
import { SettingsPanel } from "./ui/SettingsPanel";
import { Tend } from "./ui/Tend";
import { Reflect } from "./ui/Reflect";
import { VoiceNote, isAudioFile, startVoiceNote } from "./ui/VoiceNote";
import { THEMES } from "./ui/themes";
import { useHotkeys } from "./ui/useHotkeys";
import { shareToText } from "./lib/share";
import { bootSync } from "./sync/engine";
import { watchOtherTabs } from "./sync/tabs";
import { audioStore } from "./db/db";

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
        void audioStore.prune(new Set(Object.keys(useStore.getState().thoughts)));
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
      <Reflect />
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

/**
 * Handle "Share → Mindgrove" (PWA share target). A shared voice note is waiting
 * in a cache (put there by the service worker) and gets transcribed; shared
 * text drops in as a seed. Then clean the URL so a reload doesn't repeat it.
 */
function receiveShare() {
  const params = new URLSearchParams(location.search);
  if (!["title", "text", "url", "share", "share-audio"].some((k) => params.has(k))) return;
  history.replaceState(null, "", location.pathname);
  const st = useStore.getState();
  if (params.get("share") === "failed") {
    st.toast("That share didn't come through: try sharing it again");
    return;
  }
  if (params.has("share-audio")) {
    void takeSharedAudio().then((file) =>
      file ? startVoiceNote(file) : st.toast("That voice note didn't come through: try sharing it again"),
    );
    return; // any text alongside a shared file is just its name
  }
  const text = shareToText(params);
  if (!text) return;
  const id = st.capture(text);
  if (id) st.toast("Shared into your seeds", { label: "Open", run: () => useStore.getState().select(id, { open: true }) });
}

async function takeSharedAudio(): Promise<File | null> {
  try {
    const cache = await caches.open("mindgrove-shared");
    const key = `${import.meta.env.BASE_URL}__shared-audio`;
    const res = await cache.match(key);
    if (!res) return null;
    const blob = await res.blob();
    await cache.delete(key);
    const name = decodeURIComponent(res.headers.get("X-File-Name") ?? "") || "Shared voice note";
    return new File([blob], name, { type: blob.type || res.headers.get("Content-Type") || "" });
  } catch {
    return null;
  }
}
