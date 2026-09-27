/*
 * Audio clean-up before speech-to-text, all cheap and on-device:
 * - a gentle high-pass filter removes rumble, handling noise and hum below ~80 Hz
 * - loudness is evened out so quiet notes reach Whisper at a healthy level
 * - near-silent windows are found so they can be skipped (Whisper tends to
 *   invent text over silence)
 */

export function highPass(x: Float32Array, sr: number, cutoff = 80): Float32Array {
  const rc = 1 / (2 * Math.PI * cutoff);
  const dt = 1 / sr;
  const a = rc / (rc + dt);
  const y = new Float32Array(x.length);
  let prevX = 0;
  let prevY = 0;
  for (let i = 0; i < x.length; i++) {
    prevY = a * (prevY + x[i] - prevX);
    prevX = x[i];
    y[i] = prevY;
  }
  return y;
}

/** RMS of consecutive frames. */
export function frameRms(x: Float32Array, sr: number, frameSec = 0.03): Float32Array {
  const n = Math.max(1, Math.floor(frameSec * sr));
  const out = new Float32Array(Math.ceil(x.length / n));
  for (let f = 0; f < out.length; f++) {
    let e = 0;
    const end = Math.min(x.length, (f + 1) * n);
    for (let i = f * n; i < end; i++) e += x[i] * x[i];
    out[f] = Math.sqrt(e / Math.max(1, end - f * n));
  }
  return out;
}

function percentile(values: Float32Array, p: number): number {
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
}

export interface Loudness {
  noiseFloor: number;
  speechThreshold: number;
}

/** Noise floor and a speech threshold, estimated from the whole recording. */
export function analyse(x: Float32Array, sr: number): Loudness {
  const rms = frameRms(x, sr);
  const noiseFloor = percentile(rms, 0.1);
  return { noiseFloor, speechThreshold: Math.max(noiseFloor * 3, 0.004) };
}

/** Scale so speech sits around -20 dBFS (gain capped, peaks kept below clipping). */
export function normalise(x: Float32Array, sr: number, l: Loudness): Float32Array {
  const rms = frameRms(x, sr);
  let sum = 0;
  let n = 0;
  for (const r of rms)
    if (r > l.speechThreshold) {
      sum += r * r;
      n++;
    }
  if (!n) return x;
  const speechRms = Math.sqrt(sum / n);
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  const gain = Math.min(10, 0.1 / speechRms, peak > 0 ? 0.98 / peak : 10);
  if (Math.abs(gain - 1) < 0.05) return x;
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = x[i] * gain;
  return y;
}

/** Share (0–1) of a window's frames that sound like speech. */
export function speechShare(x: Float32Array, sr: number, l: Loudness): number {
  const rms = frameRms(x, sr);
  let s = 0;
  for (const r of rms) if (r > l.speechThreshold) s++;
  return rms.length ? s / rms.length : 0;
}

export function prepareAudio(x: Float32Array, sr: number): { audio: Float32Array; loudness: Loudness } {
  const filtered = highPass(x, sr);
  const before = analyse(filtered, sr);
  const audio = normalise(filtered, sr, before);
  return { audio, loudness: analyse(audio, sr) };
}

/** Does a transcript look like Whisper got stuck repeating itself? */
export function looksLooped(text: string): boolean {
  const words = text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
  if (words.length < 16) return false;
  const unique = new Set(words).size / words.length;
  // Any 3-word phrase that appears 3+ times in one ~30 s window is a loop.
  const counts = new Map<string, number>();
  let maxRepeat = 0;
  for (let i = 0; i + 2 < words.length; i++) {
    const k = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
    const c = (counts.get(k) ?? 0) + 1;
    counts.set(k, c);
    maxRepeat = Math.max(maxRepeat, c);
  }
  return unique < 0.35 || maxRepeat >= 3;
}
