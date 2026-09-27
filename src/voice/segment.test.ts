import { describe, expect, it } from "vitest";
import {
  noteTitleFrom,
  parseTime,
  previewAfterTitle,
  collapseLoops,
  cleanChunks,
  formatTime,
  mergeWithNext,
  splitWindows,
  titleFor,
  toParagraphs,
  transcriptMarkdown,
  type TimedText,
} from "./segment";

const SR = 1000; // small sample rate keeps test arrays tiny

describe("splitWindows", () => {
  it("keeps short audio in one window", () => {
    expect(splitWindows(new Float32Array(10 * SR), SR)).toEqual([{ start: 0, end: 10 * SR }]);
  });

  it("cuts long audio at the quietest moment near each boundary", () => {
    const audio = new Float32Array(70 * SR).fill(0.5);
    audio.fill(0, 25 * SR, Math.floor(25.3 * SR)); // a pause at 25 s
    const w = splitWindows(audio, SR, 28, 6);
    expect(w[0].start).toBe(0);
    expect(w[0].end / SR).toBeGreaterThan(24.9);
    expect(w[0].end / SR).toBeLessThan(25.4);
    // Windows tile the whole recording with no gaps, none longer than 28 s.
    for (let i = 1; i < w.length; i++) expect(w[i].start).toBe(w[i - 1].end);
    expect(w[w.length - 1].end).toBe(audio.length);
    for (const x of w) expect(x.end - x.start).toBeLessThanOrEqual(28 * SR);
  });
});

describe("cleanChunks", () => {
  it("drops silence markers, hallucinations and repeated lines", () => {
    const c: TimedText[] = [
      { start: 0, end: 2, text: " [BLANK_AUDIO]" },
      { start: 2, end: 5, text: " So today I want to talk about the garden. " },
      { start: 5, end: 7, text: "So today I want to talk about the garden." },
      { start: 7, end: 9, text: "(music)" },
      { start: 9, end: 10, text: "Thank you for watching!" },
      { start: 10, end: 12, text: " It needs [laughs] more light." },
    ];
    expect(cleanChunks(c)).toEqual([
      { start: 2, end: 7, text: "So today I want to talk about the garden." },
      { start: 10, end: 12, text: "It needs more light." },
    ]);
  });
});

describe("toParagraphs", () => {
  it("breaks on long pauses and on length at sentence ends", () => {
    const chunks: TimedText[] = [];
    let t = 0;
    for (let i = 0; i < 30; i++) {
      chunks.push({ start: t, end: t + 5, text: `Sentence number ${i} is about thing ${i}.` });
      t += 5 + (i === 9 ? 4 : 0.2); // a long pause after the 10th
    }
    const p = toParagraphs(chunks, { maxSeconds: 60 });
    expect(p[0].text.startsWith("Sentence number 0")).toBe(true);
    expect(p[0].text.endsWith("thing 9.")).toBe(true); // pause break
    expect(p.length).toBeGreaterThanOrEqual(3);
    for (const x of p) expect(x.end - x.start).toBeLessThanOrEqual(70);
    expect(p[1].title).toBe("Sentence number 10 is about thing 10");
    expect(p.map((x) => x.id)).toEqual(p.map((_, i) => `p${i}`));
  });

  it("tidies spacing and capitalises", () => {
    const [p] = toParagraphs([{ start: 0, end: 3, text: "well , i think so ." }]);
    expect(p.text).toBe("Well, i think so.");
  });
});

describe("titles and formatting", () => {
  it("uses the first sentence, shortened at a word boundary", () => {
    expect(titleFor("Call the physio. Then book the scan.")).toBe("Call the physio");
    const long = titleFor(
      "I keep thinking about how the whole project could be simpler if we just dropped the second phase entirely and shipped",
    );
    expect(long.length).toBeLessThanOrEqual(73);
    expect(long.endsWith("…")).toBe(true);
    expect(long).not.toMatch(/\s…$/);
  });

  it("formats times", () => {
    expect(formatTime(5)).toBe("0:05");
    expect(formatTime(754)).toBe("12:34");
    expect(formatTime(3725)).toBe("1:02:05");
  });

  it("merges paragraphs and renders a skimmable transcript", () => {
    const paras = toParagraphs([
      { start: 0, end: 4, text: "First idea." },
      { start: 10, end: 14, text: "Second idea." },
      { start: 20, end: 24, text: "Third idea." },
    ]);
    expect(paras).toHaveLength(3);
    const merged = mergeWithNext(paras, 0);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ start: 0, end: 14, text: "First idea. Second idea." });
    const md = transcriptMarkdown(merged, { duration: 24, fileName: "memo.m4a", when: new Date(0) });
    expect(md).toContain("### 0:00\n\nFirst idea. Second idea.");
    expect(md).toContain("### 0:20\n\nThird idea.");
  });
});

describe("previewAfterTitle", () => {
  it("skips the sentence already shown as the title", () => {
    expect(previewAfterTitle("Call the physio. Then book the scan.", "Call the physio")).toBe("Then book the scan.");
    expect(previewAfterTitle("Only one sentence.", "Only one sentence")).toBe("Only one sentence.");
    expect(previewAfterTitle("Long text here", "Long…")).toBe("Long text here");
    expect(previewAfterTitle("Something else. More.", "A renamed title")).toBe("Something else. More.");
  });
});

describe("decoding loops and stock phrases", () => {
  it("collapses phrases repeated three or more times", () => {
    expect(collapseLoops("this is about the 3-night of the 3-night of the 3-night of the 3-night of the garden")).toBe(
      "this is about the 3-night of the garden",
    );
    expect(collapseLoops("the third time, the third time, the third time.")).toBe("the third time.");
    // A single genuine repeat stays.
    expect(collapseLoops("I really really want this")).toBe("I really really want this");
  });

  it("drops subscribe/watching lines, alone or tacked on", () => {
    const out = cleanChunks([
      { start: 0, end: 3, text: "Don't forget to subscribe to my channel." },
      { start: 3, end: 6, text: "Remember to water the plants. Don't forget to subscribe to my channel." },
      { start: 6, end: 8, text: "Thanks for listening!" },
    ]);
    expect(out.map((c) => c.text)).toEqual(["Remember to water the plants."]);
  });
});

describe("noteTitleFrom", () => {
  const when = new Date(2026, 8, 27);
  it("keeps meaningful names and replaces machine ones", () => {
    expect(noteTitleFrom("Ideas for the garden.m4a", when)).toBe("Ideas for the garden");
    expect(noteTitleFrom("PTT-20260927-WA0003.opus", when)).toMatch(/^Voice note · /);
    expect(noteTitleFrom("AUD-20260927-WA0001.m4a", when)).toMatch(/^Voice note · /);
    expect(noteTitleFrom("Recording 12.m4a", when)).toMatch(/^Voice note · /);
    expect(noteTitleFrom("New Recording 3.m4a", when)).toMatch(/^Voice note · /);
    expect(noteTitleFrom("", when)).toMatch(/^Voice note · /);
  });
});

describe("parseTime", () => {
  it("reads timestamps back, matching formatTime", () => {
    expect(parseTime("0:25")).toBe(25);
    expect(parseTime("12:05")).toBe(725);
    expect(parseTime(formatTime(3723))).toBe(3723);
    expect(parseTime("Ideas")).toBeNull();
  });
});
