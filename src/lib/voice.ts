/* Minimal Web Speech API wrapper for voice capture (Chrome, Edge, Safari). */

interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
}

type Ctor = new () => Recognition;

function ctor(): Ctor | null {
  const w = globalThis as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const voiceSupported = () => !!ctor();

/** Start listening. `onText(finalText, interimText)` fires as words arrive. Returns a stop function. */
export function listen(onText: (final: string, interim: string) => void, onDone: (error?: string) => void): () => void {
  const C = ctor();
  if (!C) {
    onDone("unsupported");
    return () => {};
  }
  const r = new C();
  r.lang = navigator.language || "en-US";
  r.interimResults = true;
  r.continuous = true;
  let final = "";
  r.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      if (res.isFinal) final += res[0].transcript;
      else interim += res[0].transcript;
    }
    onText(final.trim(), interim.trim());
  };
  let err: string | undefined;
  r.onerror = (e) => (err = e.error);
  r.onend = () => onDone(err);
  r.start();
  return () => r.stop();
}
