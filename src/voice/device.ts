import { MODELS, type ModelKey } from "./engine";

/*
 * What this device can comfortably run, and whether a download needs a
 * heads-up (mobile data, Data Saver, low storage). Everything is best-effort:
 * browsers that don't expose a signal are treated as capable.
 */

export interface DeviceFit {
  gpu: boolean;
  memoryGB: number | null; // navigator.deviceMemory (Chrome/Android; capped at 8)
  metered: boolean; // on mobile data or Data Saver
  freeMB: number | null; // storage quota left
}

export async function deviceFit(): Promise<DeviceFit> {
  const nav = navigator as Navigator & {
    gpu?: { requestAdapter(): Promise<unknown> };
    deviceMemory?: number;
    connection?: { saveData?: boolean; type?: string; effectiveType?: string };
  };
  let gpu = false;
  try {
    gpu = !!(nav.gpu && (await nav.gpu.requestAdapter()));
  } catch {
    gpu = false;
  }
  const c = nav.connection;
  const metered = !!c && (c.saveData === true || c.type === "cellular");
  let freeMB: number | null = null;
  try {
    const est = await navigator.storage?.estimate?.();
    if (est?.quota != null) freeMB = Math.round(((est.quota ?? 0) - (est.usage ?? 0)) / 1048576);
  } catch {
    freeMB = null;
  }
  return { gpu, memoryGB: nav.deviceMemory ?? null, metered, freeMB };
}

const SIZE_MB: Record<ModelKey, number> = { fast: 80, balanced: 250, best: 500 };

/** Why a tier shouldn't be offered on this device (null = fine). */
export function blockedReason(model: ModelKey, fit: DeviceFit | null): string | null {
  if (!fit) return null;
  if (model === "best") {
    if (!fit.gpu) return "Needs a device that can use its graphics chip";
    if (fit.memoryGB != null && fit.memoryGB < 6) return "Needs a phone with more memory";
  }
  if (model === "balanced" && fit.memoryGB != null && fit.memoryGB < 2) return "Needs a phone with more memory";
  if (fit.freeMB != null && fit.freeMB < SIZE_MB[model] * 1.5) return "Not enough free storage for this model";
  return null;
}

/** Is this model already downloaded (cached by transformers.js)? */
export async function isCached(model: ModelKey): Promise<boolean> {
  try {
    if (!("caches" in globalThis)) return false;
    const cache = await caches.open("transformers-cache");
    const keys = await cache.keys();
    return keys.some((r) => r.url.includes(MODELS[model].id));
  } catch {
    return false;
  }
}

export const sizeMB = (m: ModelKey) => SIZE_MB[m];
