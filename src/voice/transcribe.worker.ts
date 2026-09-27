/// <reference lib="webworker" />
/*
 * Runs Whisper in the browser via transformers.js, one audio window at a time.
 * The library is loaded from a pinned CDN build (it isn't bundled: its npm
 * package drags in native Node deps the browser never uses). Model weights come
 * from the Hugging Face hub once and are then cached by the browser, so later
 * transcriptions work offline. Audio never leaves the device.
 */

// jsDelivr's "+esm" build rewrites the library's bare imports (onnxruntime-web)
// into CDN URLs, so it loads in a browser without a bundler.
const TRANSFORMERS_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/+esm";
// The ONNX Runtime build transformers@4.3.0 depends on; its .wasm files load from here.
const ORT_WASM = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.0-dev.20260914-8d85527a0/dist/";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Pipe = (
  audio: Float32Array,
  opts: Record<string, unknown>,
) => Promise<{ text: string; chunks?: { timestamp: [number, number | null]; text: string }[] }>;

let pipe: Pipe | null = null;
let loadedKey = "";
let device: "webgpu" | "wasm" = "wasm";

export type WorkerIn =
  { type: "load"; model: string } | { type: "window"; id: number; audio: Float32Array; offset: number; language: string | null };

export type WorkerOut =
  | { type: "loading"; progress: number; loaded: number; total: number }
  | { type: "ready"; device: "webgpu" | "wasm" }
  | { type: "result"; id: number; chunks: { start: number; end: number; text: string }[] }
  | { type: "error"; id?: number; message: string };

const post = (m: WorkerOut) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

async function hasWebGPU(): Promise<boolean> {
  try {
    const gpu = (navigator as any).gpu;
    return !!(gpu && (await gpu.requestAdapter()));
  } catch {
    return false;
  }
}

async function load(model: string) {
  const key = model;
  if (pipe && loadedKey === key) return post({ type: "ready", device });
  const T: any = await import(/* @vite-ignore */ TRANSFORMERS_URL);
  T.env.allowLocalModels = false;
  const onnx = T.env.backends?.onnx;
  if (onnx?.wasm) onnx.wasm.wasmPaths = ORT_WASM;
  const progress_callback = (p: any) => {
    if (p.status === "progress_total") post({ type: "loading", progress: p.progress, loaded: p.loaded, total: p.total });
  };
  const tryLoad = async (d: "webgpu" | "wasm") =>
    T.pipeline("automatic-speech-recognition", model, {
      device: d,
      dtype: d === "webgpu" ? { encoder_model: "fp32", decoder_model_merged: "q4" } : "q8",
      progress_callback,
    });
  device = (await hasWebGPU()) ? "webgpu" : "wasm";
  try {
    pipe = await tryLoad(device);
  } catch (e) {
    if (device !== "webgpu") throw e;
    device = "wasm"; // some GPUs/drivers can't run it; the CPU path always works
    pipe = await tryLoad(device);
  }
  loadedKey = key;
  post({ type: "ready", device });
}

self.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const msg = e.data;
  try {
    if (msg.type === "load") await load(msg.model);
    else if (msg.type === "window") {
      if (!pipe) throw new Error("Model not loaded");
      const out = await pipe(msg.audio, {
        return_timestamps: true,
        chunk_length_s: 30,
        // Keep Whisper from getting stuck repeating itself: ~30 s of speech is
        // well under 200 tokens, and a light penalty breaks loops.
        max_new_tokens: 200,
        repetition_penalty: 1.15,
        ...(msg.language ? { language: msg.language, task: "transcribe" } : {}),
      });
      const dur = msg.audio.length / 16000;
      const chunks = (out.chunks?.length ? out.chunks : [{ timestamp: [0, dur] as [number, number], text: out.text }]).map((c) => ({
        start: msg.offset + (c.timestamp[0] ?? 0),
        end: msg.offset + (c.timestamp[1] ?? dur),
        text: c.text,
      }));
      post({ type: "result", id: msg.id, chunks });
    }
  } catch (err) {
    post({ type: "error", id: msg.type === "window" ? msg.id : undefined, message: (err as Error)?.message ?? String(err) });
  }
};
