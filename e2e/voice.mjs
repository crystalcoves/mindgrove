// Real end-to-end check of voice-note transcription (run in CI, which can
// reach the model hosts): upload a spoken WAV through the UI with the Fast
// model and check the transcript contains the spoken words.
import { chromium } from "playwright";

const url = process.env.APP_URL ?? "http://localhost:4173/";
const file = process.env.AUDIO ?? "speech.wav";
const words = (process.env.EXPECT ?? "garden,tree,thought,voice,morning,water,light").split(",");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("console", (m) => m.type() === "error" && console.log("[console]", m.text()));
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
const t0 = Date.now();
await page.goto(url);
await page.waitForSelector(".row");
await page.keyboard.press("Control+k");
await page.keyboard.type("Transcribe a voice note");
await page.keyboard.press("Enter");
await page.waitForSelector(".v-drop");
await page.click(".v-opts .seg button:has-text('Fast')");
await page.setInputFiles(".v-drop input[type=file]", file);
let last = "";
const timer = setInterval(async () => {
  const s = await page.textContent(".v-status").catch(() => null);
  if (s && s !== last) console.log(`[${Math.round((Date.now() - t0) / 1000)}s] ${(last = s)}`);
}, 3000);
try {
  await page.waitForSelector(".v-parts, .v-error", { timeout: 9 * 60_000 });
} finally {
  clearInterval(timer);
  await page.screenshot({ path: "voice-e2e.png" });
}
const err = await page.textContent(".v-error").catch(() => null);
if (err) throw new Error(`Transcription failed: ${err}`);
await page.click("text=FULL TEXT");
const text = (await page.textContent(".v-full")).toLowerCase();
console.log("TRANSCRIPT:", text);
const hits = words.filter((w) => text.includes(w));
console.log(`matched ${hits.length}/${words.length}: ${hits.join(", ")} in ${Math.round((Date.now() - t0) / 1000)}s`);
await browser.close();
if (hits.length < 3) throw new Error("Transcript doesn't contain the spoken words");
