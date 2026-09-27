import { useEffect, useMemo, useRef, useState } from "react";
import { byOrder } from "../model/tree";
import { useStore } from "../store/store";
import { cancelVoice, eta, MODELS, openVoice, resetVoice, transcribeFile, useVoice, type ModelKey } from "../voice/engine";
import { formatTime, mergeWithNext, previewAfterTitle, readingMinutes, transcriptMarkdown, type Paragraph } from "../voice/segment";

const AUDIO_ACCEPT = "audio/*,.m4a,.mp3,.wav,.ogg,.opus,.webm,.aac,.flac,.amr";
const PREFS_KEY = "mindgrove:voicePrefs";

function loadPrefs(): { model: ModelKey; language: string } {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
    return { model: p.model in MODELS ? p.model : "balanced", language: typeof p.language === "string" ? p.language : "english" };
  } catch {
    return { model: "balanced", language: "english" };
  }
}

export function isAudioFile(f: File) {
  return f.type.startsWith("audio/") || /\.(m4a|mp3|wav|ogg|opus|webm|aac|flac|amr)$/i.test(f.name);
}

/** Start a transcription from anywhere (file picker, drag and drop). */
export function startVoiceNote(file: File) {
  const prefs = loadPrefs();
  openVoice(true);
  void transcribeFile(file, { model: prefs.model, language: prefs.language === "auto" ? null : prefs.language });
}

export function VoiceNote() {
  const open = useVoice((s) => s.open);
  const phase = useVoice((s) => s.phase);
  useEffect(() => {
    // Leaving mid-transcription would lose the work.
    const busy = phase === "decoding" || phase === "loading" || phase === "transcribing" || phase === "review";
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, [phase]);
  return (
    <>
      {open && <VoicePanel />}
      {!open && phase !== "idle" && <VoicePill />}
    </>
  );
}

function VoicePanel() {
  const phase = useVoice((s) => s.phase);
  const close = () => openVoice(false);
  return (
    <div
      className="scrim fade"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
      onKeyDown={(e) => e.key === "Escape" && close()}
    >
      <div className="voice panel in" role="dialog" aria-label="Transcribe a voice note">
        {phase === "idle" || phase === "error" ? <Pick /> : phase === "review" ? <Review /> : <Progress />}
      </div>
    </div>
  );
}

function Pick() {
  const error = useVoice((s) => s.error);
  const [prefs, setPrefs] = useState(loadPrefs);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const save = (p: typeof prefs) => {
    setPrefs(p);
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(p));
    } catch {
      /* ignore */
    }
  };
  const go = (f?: File | null) =>
    f && void transcribeFile(f, { model: prefs.model, language: prefs.language === "auto" ? null : prefs.language });

  return (
    <>
      <div className="v-head">
        <div className="label amber">Voice note → thoughts</div>
        <button className="icon-btn" onClick={() => openVoice(false)} aria-label="Close" autoFocus>
          ✕
        </button>
      </div>
      <div className="v-body">
        <label
          className={`v-drop${drag ? " on" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            go(e.dataTransfer.files[0]);
          }}
        >
          <input ref={input} type="file" accept={AUDIO_ACCEPT} hidden onChange={(e) => go(e.target.files?.[0])} />
          <span className="v-mic">🎙</span>
          <b>Choose or drop a recording</b>
          <small>m4a · mp3 · wav · ogg/opus · webm, up to about an hour</small>
        </label>
        {error && <div className="v-error">{error}</div>}
        <div className="v-opts">
          <div className="field">
            <span>
              Quality<small>Downloaded once, then works offline</small>
            </span>
            <div className="seg">
              {(Object.keys(MODELS) as ModelKey[]).map((k) => (
                <button
                  key={k}
                  className={prefs.model === k ? "on" : ""}
                  style={{ "--sc": "var(--accent)" } as React.CSSProperties}
                  onClick={() => save({ ...prefs, model: k })}
                  title={`${MODELS[k].note} · ${MODELS[k].size}`}
                >
                  {MODELS[k].label}
                  <small className="dim"> {MODELS[k].size}</small>
                </button>
              ))}
            </div>
          </div>
          <label className="field">
            <span>
              Language<small>Picking it is faster and more accurate than auto</small>
            </span>
            <select
              className="input"
              style={{ width: 150 }}
              value={prefs.language}
              onChange={(e) => save({ ...prefs, language: e.target.value })}
            >
              <option value="english">English</option>
              <option value="afrikaans">Afrikaans</option>
              <option value="spanish">Spanish</option>
              <option value="french">French</option>
              <option value="german">German</option>
              <option value="portuguese">Portuguese</option>
              <option value="auto">Detect automatically</option>
            </select>
          </label>
        </div>
        <small className="dim">
          Transcribed on this device, so your audio is never uploaded. Long notes take a while (on a typical laptop, about as long as the
          recording or longer; faster where the browser can use the graphics card). You can minimise this and keep working.
        </small>
      </div>
    </>
  );
}

function Progress() {
  const s = useVoice();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [s.paragraphs.length]);
  const pct = s.phase === "transcribing" && s.duration ? (s.processed / s.duration) * 100 : s.phase === "loading" ? s.modelProgress : 0;
  const left = s.phase === "transcribing" ? eta(s) : null;
  const status =
    s.phase === "decoding"
      ? "Reading the audio…"
      : s.phase === "loading"
        ? `Getting the speech model ready… ${Math.round(s.modelProgress)}% (first time only)`
        : `Transcribing ${formatTime(s.processed)} / ${formatTime(s.duration)}${left != null ? ` · about ${Math.max(1, Math.round(left / 60))} min left` : ""}`;

  return (
    <>
      <div className="v-head">
        <div className="label amber">Transcribing · {s.fileName}</div>
        <span className="v-actions">
          <button className="btn ghost small" onClick={() => openVoice(false)} title="Keep working — it continues in the background">
            Minimise
          </button>
          <button className="btn danger small" onClick={cancelVoice}>
            Cancel
          </button>
        </span>
      </div>
      <div className="v-body">
        <div className="v-status mono">
          {status}
          {s.device && <span className="dim"> · {s.device === "webgpu" ? "GPU" : "CPU"}</span>}
        </div>
        <div className="v-bar">
          <i style={{ width: `${pct}%` }} />
        </div>
        <div className="v-live" ref={list}>
          {s.paragraphs.length === 0 && <div className="dim mono v-wait">Paragraphs appear here as they're transcribed…</div>}
          {s.paragraphs.map((p) => (
            <p key={p.id}>
              <span className="v-time">{formatTime(p.start)}</span>
              {p.text}
            </p>
          ))}
        </div>
      </div>
    </>
  );
}

function Review() {
  const s = useVoice();
  const limbs = useStore((st) => st.limbs);
  const [paras, setParas] = useState<Paragraph[]>(s.paragraphs);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [view, setView] = useState<"parts" | "full">("parts");
  const [noteTitle, setNoteTitle] = useState(
    () =>
      s.fileName
        .replace(/\.[a-z0-9]+$/i, "")
        .replace(/[_-]+/g, " ")
        .trim() || "Voice note",
  );
  const [place, setPlace] = useState("");
  const fullText = useMemo(() => paras.map((p) => p.text).join(" "), [paras]);
  const count = paras.filter((p) => picked[p.id]).length;

  const save = () => {
    const st = useStore.getState();
    const final = paras.map((p) => ({ ...p, title: (titles[p.id] ?? p.title).trim() || p.title }));
    const parent = st.addThought({
      title: `🎙 ${noteTitle.trim() || "Voice note"}`,
      body: transcriptMarkdown(final, { duration: s.duration, fileName: s.fileName, when: new Date() }),
      tags: ["voice"],
      status: "seed",
      limbId: place || null,
    });
    for (const p of final.filter((x) => picked[x.id])) {
      st.addThought({
        title: p.title,
        body: `${p.text}\n\n*From the voice note at ${formatTime(p.start)}*`,
        tags: ["voice"],
        parentId: parent.id,
        status: "seed",
      });
    }
    st.toggleCollapsed(parent.id, false);
    st.select(parent.id, { open: true });
    st.setView("grove");
    st.toast(count ? `Voice note planted with ${count} branch${count > 1 ? "es" : ""}` : "Voice note planted");
    resetVoice();
    openVoice(false);
  };

  return (
    <>
      <div className="v-head">
        <div className="label amber">
          Review · {formatTime(s.duration)} · {paras.length} parts · {readingMinutes(fullText)} min read
        </div>
        <button className="icon-btn" onClick={() => openVoice(false)} aria-label="Minimise">
          ✕
        </button>
      </div>
      <div className="v-body">
        <div className="v-row">
          <input
            className="input"
            value={noteTitle}
            onChange={(e) => setNoteTitle(e.target.value)}
            aria-label="Voice note title"
            placeholder="Name this voice note"
          />
          <select
            className="input"
            style={{ width: 190 }}
            value={place}
            onChange={(e) => setPlace(e.target.value)}
            aria-label="Where to plant it"
          >
            <option value="">Seeds · inbox</option>
            {Object.values(limbs)
              .sort(byOrder)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  Limb · {l.name}
                </option>
              ))}
          </select>
        </div>
        <div className="v-row v-tools">
          <div className="views" role="tablist">
            <button className={view === "parts" ? "on" : ""} onClick={() => setView("parts")}>
              PARTS
            </button>
            <button className={view === "full" ? "on" : ""} onClick={() => setView("full")}>
              FULL TEXT
            </button>
          </div>
          {view === "parts" && (
            <span className="dim mono" style={{ fontSize: 11 }}>
              Tick the parts that deserve their own branch ·{" "}
              <button className="btn ghost small" onClick={() => setPicked(Object.fromEntries(paras.map((p) => [p.id, true])))}>
                All
              </button>
              <button className="btn ghost small" onClick={() => setPicked({})}>
                None
              </button>
            </span>
          )}
        </div>

        {view === "full" ? (
          <div className="v-full">
            {paras.map((p) => (
              <p key={p.id}>
                <span className="v-time">{formatTime(p.start)}</span>
                {p.text}
              </p>
            ))}
          </div>
        ) : (
          <div className="v-parts">
            {paras.map((p, i) => (
              <div key={p.id} className={`v-part${picked[p.id] ? " on" : ""}`}>
                <input
                  type="checkbox"
                  checked={!!picked[p.id]}
                  onChange={(e) => setPicked((x) => ({ ...x, [p.id]: e.target.checked }))}
                  aria-label={`Make part at ${formatTime(p.start)} a branch`}
                />
                <div className="v-part-main">
                  <div className="v-part-top">
                    <span className="v-time">{formatTime(p.start)}</span>
                    <input
                      className="v-title"
                      value={titles[p.id] ?? p.title}
                      onChange={(e) => setTitles((x) => ({ ...x, [p.id]: e.target.value }))}
                      aria-label="Branch title"
                    />
                  </div>
                  <p className={`v-text${open[p.id] ? " open" : ""}`} onClick={() => setOpen((x) => ({ ...x, [p.id]: !x[p.id] }))}>
                    {open[p.id] ? p.text : previewAfterTitle(p.text, p.title)}
                  </p>
                </div>
                {i < paras.length - 1 && (
                  <button
                    className="x v-merge"
                    title="Join with the next part"
                    aria-label="Join with the next part"
                    onClick={() => {
                      const next = paras[i + 1];
                      setParas(mergeWithNext(paras, i));
                      setPicked((x) => ({ ...x, [p.id]: x[p.id] || x[next.id] }));
                    }}
                  >
                    ⤓
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="v-foot">
        <button className="btn ghost" onClick={() => confirm("Discard this transcript?") && (resetVoice(), openVoice(false))}>
          Discard
        </button>
        <span className="dim mono" style={{ fontSize: 11 }}>
          Saves one voice-note thought with the full transcript{count ? ` + ${count} branch${count > 1 ? "es" : ""}` : ""}
        </span>
        <button className="btn solid" onClick={save}>
          ✦ Plant
        </button>
      </div>
    </>
  );
}

function VoicePill() {
  const s = useVoice();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const pct = s.duration ? Math.round((s.processed / s.duration) * 100) : 0;
  const left = eta(s);
  const text =
    s.phase === "review"
      ? "Voice note ready — review"
      : s.phase === "error"
        ? "Voice note failed — details"
        : s.phase === "transcribing"
          ? `Transcribing ${pct}%${left != null ? ` · ~${Math.max(1, Math.round(left / 60))} min` : ""}`
          : "Preparing voice note…";
  return (
    <button className={`voice-pill panel${s.phase === "review" ? " ready" : ""}`} onClick={() => openVoice(true)}>
      🎙 {text}
      {s.phase === "transcribing" && (
        <span className="v-bar mini">
          <i style={{ width: `${pct}%` }} />
        </span>
      )}
    </button>
  );
}
