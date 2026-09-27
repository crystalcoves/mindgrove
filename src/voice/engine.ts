import { create } from "zustand";
import { looksLooped, prepareAudio, speechShare } from "./audio";
import { cleanChunks, SAMPLE_RATE, splitWindows, toParagraphs, type Paragraph, type TimedText } from "./segment";
import type { WorkerIn, WorkerOut } from "./transcribe.worker";

/*
 * Voice-note transcription: decode the file to 16 kHz mono, cut it into
 * ~28 s windows at quiet moments, and feed them one by one to a Whisper
 * worker so long recordings show steady progress and can be cancelled.
 * State lives in a store so the job keeps running while the panel is closed.
 */

export const MODELS = {
  fast: { id: "onnx-community/whisper-base", label: "Fast", size: "~80 MB", note: "quick, good for clear speech" },
  balanced: { id: "onnx-community/whisper-small", label: "Balanced", size: "~250 MB", note: "noticeably more accurate — the default" },
  best: {
    id: "onnx-community/whisper-large-v3-turbo",
    label: "Best",
    size: "~500 MB",
    note: "most accurate; wants a GPU (most recent phones and laptops)",
  },
} as const;
export type ModelKey = keyof typeof MODELS;

export type Phase = "idle" | "decoding" | "loading" | "transcribing" | "review" | "error";

interface VoiceState {
  phase: Phase;
  open: boolean;
  fileName: string;
  duration: number; // seconds
  processed: number; // seconds of audio transcribed
  modelProgress: number; // 0-100 while downloading the model
  device: "webgpu" | "wasm" | null;
  startedAt: number;
  chunks: TimedText[];
  paragraphs: Paragraph[];
  error: string | null;
}

const initial: VoiceState = {
  phase: "idle",
  open: false,
  fileName: "",
  duration: 0,
  processed: 0,
  modelProgress: 0,
  device: null,
  startedAt: 0,
  chunks: [],
  paragraphs: [],
  error: null,
};

export const useVoice = create<VoiceState>(() => initial);

/** Test hook: a fake per-window transcriber (dev builds only). */
type FakeTranscriber = (audio: Float32Array, offset: number) => Promise<TimedText[]>;
const fake = (): FakeTranscriber | undefined =>
  import.meta.env.DEV ? (globalThis as unknown as { __mgFakeTranscribe?: FakeTranscriber }).__mgFakeTranscribe : undefined;

let worker: Worker | null = null;
let job = 0;
// The recording being transcribed, so it can be kept for playback once planted.
let currentFile: File | null = null;
export const voiceFile = () => currentFile;

export const openVoice = (open = true) => useVoice.setState({ open });

export function resetVoice() {
  cancelVoice();
  currentFile = null;
  useVoice.setState({ ...initial, open: useVoice.getState().open });
}

export function cancelVoice() {
  job++;
  worker?.terminate();
  worker = null;
  if (useVoice.getState().phase !== "review") useVoice.setState({ ...initial, open: useVoice.getState().open });
}

export async function decodeAudio(file: Blob): Promise<Float32Array> {
  const bytes = await file.arrayBuffer();
  const Ctx =
    globalThis.OfflineAudioContext ??
    (globalThis as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  // Decoding into a 16 kHz context resamples for us.
  const ctx = new Ctx(1, 1, SAMPLE_RATE);
  let buf: AudioBuffer;
  try {
    buf = await ctx.decodeAudioData(bytes);
  } catch {
    throw new Error("This browser can't read that audio format. Try an mp3, m4a or wav, or open Mindgrove in Chrome.");
  }
  if (buf.numberOfChannels === 1) return buf.getChannelData(0);
  const out = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i] += ch[i] / buf.numberOfChannels;
  }
  return out;
}

function call(w: Worker, msg: WorkerIn, transfer: Transferable[] = []): Promise<WorkerOut> {
  return new Promise((resolve, reject) => {
    const onMsg = (e: MessageEvent<WorkerOut>) => {
      const m = e.data;
      if (m.type === "loading") {
        useVoice.setState({ modelProgress: m.progress });
        return;
      }
      w.removeEventListener("message", onMsg);
      if (m.type === "error") reject(new Error(m.message));
      else resolve(m);
    };
    w.addEventListener("message", onMsg);
    w.addEventListener("error", (e) => reject(new Error(e.message || "Transcription worker crashed")), { once: true });
    w.postMessage(msg, transfer);
  });
}

export async function transcribeFile(file: File, opts: { model: ModelKey; language: string | null }) {
  cancelVoice();
  const my = ++job;
  const alive = () => my === job;
  currentFile = file;
  useVoice.setState({ ...initial, open: useVoice.getState().open, phase: "decoding", fileName: file.name, startedAt: Date.now() });
  try {
    const decoded = await decodeAudio(file);
    // Filter rumble, even out loudness, and learn what silence sounds like here.
    const { audio, loudness } = prepareAudio(decoded, SAMPLE_RATE);
    if (!alive()) return;
    const duration = audio.length / SAMPLE_RATE;
    if (duration < 0.5) throw new Error("That recording is empty.");
    useVoice.setState({ duration });
    const windows = splitWindows(audio);

    const fakeT = fake();
    let w: Worker | null = null;
    if (!fakeT) {
      useVoice.setState({ phase: "loading" });
      w = worker = new Worker(new URL("./transcribe.worker.ts", import.meta.url), { type: "module" });
      const ready = await call(w, { type: "load", model: MODELS[opts.model].id });
      if (!alive()) return;
      if (ready.type === "ready") useVoice.setState({ device: ready.device });
    }

    useVoice.setState({ phase: "transcribing", startedAt: Date.now() });
    for (let i = 0; i < windows.length; i++) {
      const { start, end } = windows[i];
      const slice = audio.slice(start, end);
      const offset = start / SAMPLE_RATE;
      let chunks: TimedText[] = [];
      // Skip windows that are basically silence: nothing to hear, and it's where
      // Whisper is most likely to invent text.
      if (speechShare(slice, SAMPLE_RATE, loudness) >= 0.02) {
        const run = async (strict: boolean) => {
          if (fakeT) return fakeT(slice.slice(), offset);
          const copy = slice.slice(); // the buffer is transferred to the worker
          const res = await call(w!, { type: "window", id: i, audio: copy, offset, language: opts.language, strict }, [copy.buffer]);
          return res.type === "result" ? res.chunks : [];
        };
        chunks = await run(false);
        // Stuck in a loop? Run this window again with stricter decoding.
        if (looksLooped(chunks.map((c) => c.text).join(" "))) chunks = await run(true);
      }
      if (!alive()) return;
      const all = cleanChunks([...useVoice.getState().chunks, ...chunks]);
      useVoice.setState({ chunks: all, processed: end / SAMPLE_RATE, paragraphs: toParagraphs(all) });
    }
    worker?.terminate();
    worker = null;
    const paragraphs = useVoice.getState().paragraphs;
    if (!paragraphs.length) throw new Error("No speech found in that recording.");
    useVoice.setState({ phase: "review" });
  } catch (e) {
    if (!alive()) return;
    worker?.terminate();
    worker = null;
    useVoice.setState({ phase: "error", error: (e as Error).message || "Transcription failed" });
  }
}

/** Seconds left, estimated from progress so far. */
export function eta(s: Pick<VoiceState, "processed" | "duration" | "startedAt">, now = Date.now()): number | null {
  if (s.processed <= 0) return null;
  const rate = s.processed / ((now - s.startedAt) / 1000);
  return rate > 0 ? (s.duration - s.processed) / rate : null;
}
