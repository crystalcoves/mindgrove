import { registerSW } from "virtual:pwa-register";
import { useStore } from "../store/store";
import { useVoice } from "../voice/engine";

/*
 * App updates. An installed app resumed from the background never reloads, so
 * it would keep running an old version: check for a new one whenever the app
 * comes back to the front (and hourly). Switch straight away when nothing is in
 * progress; otherwise offer a Reload button.
 */

const HOUR = 3600_000;

/** Nothing would be lost by reloading right now. */
function idle() {
  const st = useStore.getState();
  const v = useVoice.getState().phase;
  const voiceBusy = v === "decoding" || v === "loading" || v === "transcribing" || v === "review";
  return !voiceBusy && !st.editingId && !st.captureOpen && !document.querySelector("textarea:focus, input:focus");
}

export function startUpdates() {
  let offered = false;
  const update = registerSW({
    immediate: true,
    onNeedRefresh() {
      if (idle()) return void update(true);
      if (offered) return;
      offered = true;
      useStore.getState().toast("A new version of Mindgrove is ready", { label: "Reload", run: () => void update(true) });
    },
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      const check = () => void reg.update().catch(() => {});
      setInterval(check, HOUR);
      document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && check());
      addEventListener("online", check);
    },
  });
}
