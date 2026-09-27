/*
 * Voice-note helpers: cut long audio into model-sized windows at quiet
 * moments, clean up Whisper output, and group it into readable paragraphs.
 * All pure, so they're unit-tested without a model.
 */

export const SAMPLE_RATE = 16_000;

export interface TimedText {
  start: number; // seconds from the start of the recording
  end: number;
  text: string;
}

export interface Paragraph extends TimedText {
  id: string;
  title: string;
}

/**
 * Split audio into windows of at most `max` seconds, cutting at the quietest
 * 100 ms within the last `search` seconds of each window so words aren't
 * chopped in half.
 */
export function splitWindows(audio: Float32Array, sr = SAMPLE_RATE, max = 28, search = 6): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  const maxN = Math.floor(max * sr);
  const frame = Math.floor(0.1 * sr);
  let pos = 0;
  while (pos < audio.length) {
    if (audio.length - pos <= maxN) {
      out.push({ start: pos, end: audio.length });
      break;
    }
    const lo = pos + maxN - Math.floor(search * sr);
    let best = pos + maxN;
    let bestE = Infinity;
    for (let f = lo; f + frame <= pos + maxN; f += frame) {
      let e = 0;
      for (let i = f; i < f + frame; i++) e += audio[i] * audio[i];
      if (e < bestE) {
        bestE = e;
        best = f + (frame >> 1);
      }
    }
    out.push({ start: pos, end: best });
    pos = best;
  }
  return out;
}

// Whisper invents these over silence or music; drop them.
const NOISE =
  /^\s*[[(]?\s*(blank[_ ]audio|silence|music|applause|laughter|inaudible|no speech|noise|background noise|sound|foreign)\s*[\])]?\s*\.?\s*$/i;
const HALLUCINATIONS = [
  /^thanks? (you )?(so much )?for (watching|listening)[.!]*$/i,
  /^(please |don'?t forget to )?(like (and|&) )?subscribe( to (my|the|our) channel)?[.!]*$/i,
  /^subtitles by .*$/i,
  /^\.+$/,
];
// Stock phrases Whisper tacks onto the end of otherwise-real text.
const TAIL_JUNK =
  /\s*(?:(?:please |and )?(?:don'?t forget to )?(?:like (?:and|&) )?subscribe(?: to (?:my|the|our) channel)?|thanks? (?:you )?for watching)[.!]*\s*$/i;

/** Collapse a phrase repeated 3+ times in a row (Whisper's decoding loops) to one. */
export function collapseLoops(text: string): string {
  let out = text;
  for (let i = 0; i < 3; i++) {
    const next = out.replace(/\b(\S+(?:\s+\S+){0,11}?)(?:[\s,.;:-]+\1\b){2,}/gi, "$1");
    if (next === out) break;
    out = next;
  }
  return out;
}

export function cleanChunks(chunks: TimedText[]): TimedText[] {
  const out: TimedText[] = [];
  for (const c of chunks) {
    const text = collapseLoops(
      c.text
        .replace(/\[[^\]]*\]|\(\s*(music|laughs?|applause|silence|inaudible)\s*\)/gi, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
      .replace(TAIL_JUNK, "")
      .trim();
    if (!text || NOISE.test(text) || HALLUCINATIONS.some((r) => r.test(text))) continue;
    // Whisper sometimes loops the same line; keep one.
    const prev = out[out.length - 1];
    if (prev && prev.text.toLowerCase() === text.toLowerCase()) {
      prev.end = Math.max(prev.end, c.end);
      continue;
    }
    out.push({ start: c.start, end: Math.max(c.end, c.start), text });
  }
  return out;
}

/**
 * Group cleaned chunks into paragraphs: break on a long pause, or once a
 * paragraph is long enough and the sentence has ended.
 */
export function toParagraphs(chunks: TimedText[], opts: { pause?: number; maxSeconds?: number; maxChars?: number } = {}): Paragraph[] {
  const pause = opts.pause ?? 2.5;
  const maxSeconds = opts.maxSeconds ?? 75;
  const maxChars = opts.maxChars ?? 650;
  const paras: Paragraph[] = [];
  let cur: TimedText | null = null;
  const flush = () => {
    if (!cur) return;
    const text = tidy(cur.text);
    paras.push({ id: `p${paras.length}`, start: cur.start, end: cur.end, text, title: titleFor(text) });
    cur = null;
  };
  for (const c of chunks) {
    if (cur) {
      const gap = c.start - cur.end;
      const long = cur.end - cur.start >= maxSeconds || cur.text.length >= maxChars;
      const sentenceDone = /[.!?…]["')\]]?$/.test(cur.text.trim());
      if (gap >= pause || (long && sentenceDone) || cur.text.length >= maxChars * 1.8) flush();
    }
    if (!cur) cur = { ...c };
    else {
      cur.text += " " + c.text;
      cur.end = c.end;
    }
  }
  flush();
  return paras;
}

function tidy(text: string): string {
  const t = text
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** First sentence (or first words), short enough to be a thought's title. */
export function titleFor(text: string, max = 72): string {
  const first = (text.match(/^.*?[.!?…](?=\s|$)/)?.[0] ?? text).trim().replace(/[.…]+$/, "");
  if (first.length <= max) return first;
  const cut = first.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), max * 0.6)).replace(/[,;:\s]+$/, "") + "…";
}

export function formatTime(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  return h ? `${h}:${mm}:${String(r).padStart(2, "0")}` : `${mm}:${String(r).padStart(2, "0")}`;
}

/** Merge paragraph `i` with the next one. */
export function mergeWithNext(paras: Paragraph[], i: number): Paragraph[] {
  if (i < 0 || i >= paras.length - 1) return paras;
  const a = paras[i];
  const b = paras[i + 1];
  const text = `${a.text} ${b.text}`;
  const merged: Paragraph = { id: a.id, start: a.start, end: b.end, text, title: a.title };
  return [...paras.slice(0, i), merged, ...paras.slice(i + 2)];
}

/** Markdown body for the voice-note thought: timestamped sections, easy to skim. */
export function transcriptMarkdown(paras: Paragraph[], meta: { duration: number; fileName: string; when: Date }): string {
  const head = `*Voice note · ${formatTime(meta.duration)} · ${meta.fileName} · transcribed ${meta.when.toLocaleDateString()}*`;
  return [head, ...paras.map((p) => `### ${formatTime(p.start)}\n\n${p.text}`)].join("\n\n");
}

export const readingMinutes = (text: string) => Math.max(1, Math.round(text.split(/\s+/).length / 230));

/** Text to preview under a title, without repeating the title's own sentence. */
export function previewAfterTitle(text: string, title: string): string {
  const t = title.replace(/…$/, "");
  if (!title.endsWith("…") && text.startsWith(t)) {
    const rest = text.slice(t.length).replace(/^[.!?…]+\s*/, "");
    return rest || text;
  }
  return text;
}

/**
 * A readable default title from a recording's file name. Machine names like
 * WhatsApp's "PTT-20260927-WA0003.opus" or "Recording 12.m4a" become "Voice note · 27 Sep".
 */
export function noteTitleFrom(fileName: string, when = new Date()): string {
  const base = fileName
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[_-]+/g, " ")
    .trim();
  // Only recorder boilerplate and numbers? Then the name says nothing.
  const leftover = base.replace(/\b(ptt|aud|audio|voice|note|rec|recording|new|memo|wa\d*)\b|\d+/gi, "").trim();
  if (leftover) return base;
  return `Voice note · ${when.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}

/** "1:05" or "1:02:03" → seconds; null if it isn't a timestamp. */
export function parseTime(s: string): number | null {
  const m = /^\s*(?:(\d+):)?(\d{1,2}):(\d{2})\s*$/.exec(s);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}
