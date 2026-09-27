import { describe, expect, it } from "vitest";
import { analyse, frameRms, highPass, looksLooped, normalise, prepareAudio, speechShare } from "./audio";

const SR = 16000;
const tone = (sec: number, hz: number, amp: number) =>
  Float32Array.from({ length: sec * SR }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR));
const rms = (x: Float32Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);

describe("audio clean-up", () => {
  it("high-pass removes rumble but keeps voice frequencies", () => {
    expect(rms(highPass(tone(1, 30, 0.5), SR)) / rms(tone(1, 30, 0.5))).toBeLessThan(0.45);
    expect(rms(highPass(tone(1, 300, 0.5), SR)) / rms(tone(1, 300, 0.5))).toBeGreaterThan(0.95);
  });

  it("brings quiet speech up to a healthy level without clipping", () => {
    const quiet = new Float32Array(4 * SR);
    quiet.set(tone(2, 250, 0.01), SR); // 2 s of quiet "speech" in 4 s
    const out = prepareAudio(quiet, SR).audio;
    const speech = out.subarray(SR, 3 * SR);
    expect(rms(speech)).toBeGreaterThan(0.05);
    expect(Math.max(...out.map(Math.abs))).toBeLessThan(1);
    const loud = tone(2, 250, 0.9);
    expect(Math.max(...normalise(loud, SR, analyse(loud, SR)).map(Math.abs))).toBeLessThan(1);
  });

  it("tells silent windows from speech", () => {
    const x = new Float32Array(10 * SR);
    for (let i = 0; i < x.length; i++) x[i] = (Math.random() - 0.5) * 0.002; // hiss
    x.set(tone(3, 250, 0.2), 5 * SR);
    const l = analyse(x, SR);
    expect(speechShare(x.subarray(0, 4 * SR), SR, l)).toBeLessThan(0.03);
    expect(speechShare(x.subarray(5 * SR, 8 * SR), SR, l)).toBeGreaterThan(0.9);
    expect(frameRms(x, SR).length).toBeGreaterThan(300);
  });

  it("spots decoding loops", () => {
    expect(looksLooped("the 3 night of the 3 night of the 3 night of the 3 night of the day and the garden grows")).toBe(true);
    expect(
      looksLooped(
        "So I've been thinking about the move and what it means for work. The commute would be shorter, which frees up mornings.",
      ),
    ).toBe(false);
  });
});
