import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { limbColorOf } from "../grove/Grove";
import { renderMarkdown } from "../lib/md";
import { fullDate, relTime } from "../lib/keys";
import { ancestors, byOrder, isWilting, parseCapture } from "../model/tree";
import { STATUSES, STATUS_META, type Thought } from "../model/types";
import { useStore } from "../store/store";
import { STATUS_COLORS } from "./themes";
import { suggestVines } from "../model/suggest";
import { formatTime, parseTime, readingMinutes } from "../voice/segment";
import { audioStore } from "../db/db";

export function Detail({ floating }: { floating?: boolean }) {
  const id = useStore((s) => s.selectedId);
  const open = useStore((s) => s.detailOpen);
  const t = useStore((s) => (id ? s.thoughts[id] : undefined));

  // Opening a thought (and lingering) counts as tending it: it stops wilting.
  useEffect(() => {
    if (!id || !open) return;
    const timer = setTimeout(() => useStore.getState().touch(id), 1500);
    return () => clearTimeout(timer);
  }, [id, open]);

  if (!open || !t) return null;
  return (
    <aside className={`detail panel in${floating ? " floating" : ""}`} aria-label="Thought details" key={t.id}>
      <DetailBody t={t} />
    </aside>
  );
}

function DetailBody({ t }: { t: Thought }) {
  const thoughts = useStore((s) => s.thoughts);
  const limbs = useStore((s) => s.limbs);
  const links = useStore((s) => s.links);
  const wiltWeeks = useStore((s) => s.settings.wiltWeeks);
  const view = useStore((s) => s.view);
  const st = useStore.getState;

  const chain = ancestors(thoughts, t.id);
  const root = chain[0] ?? t;
  const limb = root.limbId ? limbs[root.limbId] : null;
  const color = limbColorOf(thoughts, limbs, t);
  const kids = useMemo(
    () =>
      Object.values(thoughts)
        .filter((x) => x.parentId === t.id)
        .sort(byOrder),
    [thoughts, t.id],
  );
  const vines = Object.values(links).filter((l) => l.from === t.id || l.to === t.id);
  const wilting = isWilting(t, Date.now(), wiltWeeks);
  const audio = useVoiceAudio(t);

  return (
    <div className="detail-scroll">
      <div className="d-top">
        <div className="d-crumb" style={{ "--c": limb?.color ?? "#9fb4c2" } as React.CSSProperties}>
          <span className="limb">{limb ? limb.name : "Seeds"}</span>
          {chain.map((a) => (
            <span key={a.id}>
              › <button onClick={() => st().select(a.id, { open: true })}>{a.title || "untitled"}</button>
            </span>
          ))}
        </div>
        <button className="icon-btn" onClick={() => st().openDetail(false)} aria-label="Close details" title="Close (Esc)">
          ✕
        </button>
      </div>

      <TitleField t={t} />

      {wilting && (
        <div className="wilt-note">
          <span>❦ Untouched for {relTime(t.touchedAt)} — wilting.</span>
          <span style={{ display: "flex", gap: 6 }}>
            <button className="btn small" onClick={() => st().touch(t.id)}>
              Revive
            </button>
            <button className="btn ghost small" onClick={() => st().setStatus(t.id, "pruned")}>
              Prune
            </button>
          </span>
        </div>
      )}

      <section className="d-sec">
        <div className="label">Status</div>
        <div className="seg" role="radiogroup" aria-label="Status">
          {STATUSES.map((s) => (
            <button
              key={s}
              role="radio"
              aria-checked={t.status === s}
              className={t.status === s ? "on" : ""}
              style={{ "--sc": STATUS_COLORS[s] } as React.CSSProperties}
              title={STATUS_META[s].hint}
              onClick={() => st().setStatus(t.id, s)}
            >
              {STATUS_META[s].glyph} {STATUS_META[s].label}
            </button>
          ))}
        </div>
      </section>

      <section className="d-sec">
        <div className="label">
          Place
          <button className="btn ghost small" onClick={() => st().openPalette(true, "move")}>
            Move… <kbd>M</kbd>
          </button>
        </div>
        {!t.parentId && (
          <select
            className="input"
            value={t.limbId ?? ""}
            onChange={(e) => st().move(t.id, { parentId: null, limbId: e.target.value || null })}
            aria-label="Limb"
          >
            <option value="">Seeds · inbox (unplaced)</option>
            {Object.values(limbs)
              .sort(byOrder)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  Limb · {l.name}
                </option>
              ))}
          </select>
        )}
        {t.parentId && (
          <div className="dim mono" style={{ fontSize: 12 }}>
            Follow-up of “{thoughts[t.parentId]?.title}”
          </div>
        )}
      </section>

      <TagsField t={t} />
      <VoicePlayer key={t.id} t={t} audio={audio} />
      <BodyField t={t} seek={audio.seek} />

      <section className="d-sec">
        <div className="label">
          Follow-ups <span className="dim">{kids.length}</span>
        </div>
        <div className="list">
          {kids.map((k) => (
            <div key={k.id} className="list-item">
              <button
                className="status"
                style={{ "--sc": STATUS_COLORS[k.status] } as React.CSSProperties}
                onClick={() => st().cycleStatus(k.id)}
                title={STATUS_META[k.status].label}
              >
                {STATUS_META[k.status].glyph}
              </button>
              <span className="grow" onClick={() => st().select(k.id, { open: true })}>
                {k.title || "untitled"}
              </span>
            </div>
          ))}
        </div>
        <QuickAdd
          placeholder="Add a follow-up… (Enter)"
          onAdd={(text) => {
            const { title, tags } = parseCapture(text);
            st().addThought({ title, tags, parentId: t.id, status: "growing" });
            st().toggleCollapsed(t.id, false);
          }}
        />
      </section>

      <section className="d-sec">
        <div className="label">
          Vines <span className="dim">{vines.length}</span>
          <button className="btn ghost small" onClick={() => st().openPalette(true, "link")}>
            + Link… <kbd>L</kbd>
          </button>
        </div>
        <div className="list">
          {vines.length === 0 && (
            <div className="dim mono" style={{ fontSize: 12 }}>
              Connect this to a thought on another branch.
            </div>
          )}
          {vines.map((l) => {
            const other = thoughts[l.from === t.id ? l.to : l.from];
            if (!other) return null;
            return (
              <div key={l.id} className="list-item" style={{ "--c": limbColorOf(thoughts, limbs, other) } as React.CSSProperties}>
                <span style={{ color: "var(--c)" }}>⟿</span>
                <span className="grow" onClick={() => st().select(other.id, { open: true })}>
                  {other.title || "untitled"}
                </span>
                <button className="x" onClick={() => st().removeLink(l.id)} aria-label="Remove vine" title="Remove vine">
                  ✕
                </button>
              </div>
            );
          })}
        </div>
        <SuggestedVines t={t} />
      </section>

      <section className="d-sec">
        <div className="label">History</div>
        <div className="dates">
          <b>Planted</b>
          <span>{fullDate(t.createdAt)}</span>
          <b>Edited</b>
          <span>{fullDate(t.updatedAt)}</span>
          <b>Tended</b>
          <span>
            {fullDate(t.touchedAt)} · {relTime(t.touchedAt)} ago
          </span>
        </div>
      </section>

      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, paddingTop: 4 }}>
        <button
          className="btn"
          style={{ "--c": color } as React.CSSProperties}
          onClick={() => st().setView(view === "grove" ? "canopy" : "grove")}
        >
          {view === "grove" ? "◈ See in canopy" : "☰ See in grove"}
        </button>
        <button className="btn danger" onClick={() => st().remove(t.id)}>
          Remove
        </button>
      </div>
    </div>
  );
}

function TitleField({ t }: { t: Thought }) {
  const [value, setValue] = useState(t.title);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setValue(t.title), [t.title]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "auto";
      el.style.height = el.scrollHeight + "px";
    };
    fit();
    // Fonts and the panel's entrance can change the measured height.
    const raf = requestAnimationFrame(fit);
    const ro = new ResizeObserver(fit);
    ro.observe(el.parentElement ?? el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [value]);
  const commit = () => {
    const v = value.replace(/\s+/g, " ").trim();
    if (v && v !== t.title) useStore.getState().update(t.id, { title: v });
    else setValue(t.title);
  };
  return (
    <textarea
      ref={ref}
      rows={1}
      className="d-title"
      value={value}
      aria-label="Title"
      placeholder="Untitled thought"
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
        if (e.key === "Escape") {
          setValue(t.title);
          requestAnimationFrame(() => ref.current?.blur());
        }
      }}
    />
  );
}

function TagsField({ t }: { t: Thought }) {
  const [draft, setDraft] = useState("");
  const setTags = (tags: string[]) => useStore.getState().update(t.id, { tags });
  const add = () => {
    const tags = draft
      .split(/[\s,]+/)
      .map((x) => x.replace(/^#/, "").toLowerCase())
      .filter(Boolean);
    if (tags.length) setTags([...new Set([...t.tags, ...tags])]);
    setDraft("");
  };
  return (
    <section className="d-sec">
      <div className="label">Tags</div>
      <div className="tags">
        {t.tags.map((tag) => (
          <span key={tag} className="t">
            #{tag}
            <button onClick={() => setTags(t.tags.filter((x) => x !== tag))} aria-label={`Remove tag ${tag}`}>
              ✕
            </button>
          </span>
        ))}
        <input
          value={draft}
          placeholder="+ tag"
          aria-label="Add tag"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={add}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add();
            }
            if (e.key === "Backspace" && !draft && t.tags.length) setTags(t.tags.slice(0, -1));
          }}
        />
      </div>
    </section>
  );
}

/** Where a voice note's recording is played from: its own saved audio, or (for a part planted as a branch) its parent's. */
function useVoiceAudio(t: Thought) {
  const ownerId = t.tags.includes("voice") ? (/^\*Voice note ·/.test(t.body) ? t.id : t.parentId) : null;
  const [url, setUrl] = useState<string | null>(null);
  const el = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    setUrl(null);
    if (!ownerId) return;
    let objectUrl: string | null = null;
    let live = true;
    void audioStore.get(ownerId).then((a) => {
      if (!a || !live) return;
      objectUrl = URL.createObjectURL(a.blob);
      setUrl(objectUrl);
    });
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [ownerId]);
  const seek = url
    ? (sec: number) => {
        const a = el.current;
        if (!a) return;
        a.currentTime = sec;
        void a.play().catch(() => {});
      }
    : null;
  return { url, el, seek };
}

type VoiceAudioState = ReturnType<typeof useVoiceAudio>;

function VoicePlayer({ t, audio }: { t: Thought; audio: VoiceAudioState }) {
  if (!audio.url) return null;
  // A part planted as a branch remembers where it came from: "…at 12:05".
  const from = /at (\d+:\d{2}(?::\d{2})?)\*?\s*$/.exec(t.body)?.[1];
  const start = from ? parseTime(from) : null;
  return (
    <section className="d-sec voice-play">
      <div className="label">
        Recording
        {start != null && (
          <button className="btn small solid" onClick={() => audio.seek?.(start)}>
            ▶ Play from {formatTime(start)}
          </button>
        )}
      </div>
      <audio ref={audio.el} src={audio.url} controls preload="metadata" />
      {start == null && <small className="dim">Tap a timestamp in the transcript to jump there.</small>}
    </section>
  );
}

function BodyField({ t, seek }: { t: Thought; seek?: ((sec: number) => void) | null }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(t.body);
  useEffect(() => {
    if (!editing) setValue(t.body);
  }, [t.body, editing]);
  const html = useMemo(() => renderMarkdown(t.body), [t.body]);
  // Long notes (e.g. voice-note transcripts) start folded so the panel stays calm.
  const long = t.body.length > 1200;
  const [expanded, setExpanded] = useState(false);
  const commit = () => {
    if (value !== t.body) useStore.getState().update(t.id, { body: value });
    setEditing(false);
  };
  return (
    <section className="d-sec">
      <div className="label">
        Notes
        <button className="btn ghost small" onClick={() => (editing ? commit() : setEditing(true))}>
          {editing ? "Done" : "Edit"}
        </button>
      </div>
      {editing ? (
        <textarea
          className={`input body-edit${long ? " tall" : ""}`}
          autoFocus
          value={value}
          placeholder={"Markdown works: **bold**, - lists, [links](https://…)"}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
              e.preventDefault();
              commit();
            }
          }}
        />
      ) : (
        <>
          <div
            className={`md${long && !expanded ? " folded" : ""}${seek ? " seekable" : ""}`}
            onClick={(e) => {
              const el = e.target as HTMLElement;
              // Transcript timestamps play the recording from there.
              const at = seek && el.tagName === "H3" ? parseTime(el.textContent ?? "") : null;
              if (at != null) return seek!(at);
              if (!long && el.tagName !== "A") setEditing(true);
            }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
          {long && (
            <button className="btn ghost small md-more" onClick={() => setExpanded((v) => !v)}>
              {expanded ? "Fold ▴" : `Show all · ${readingMinutes(t.body)} min read ▾`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function QuickAdd({ placeholder, onAdd }: { placeholder: string; onAdd: (text: string) => void }) {
  const [v, setV] = useState("");
  return (
    <input
      className="input"
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && v.trim()) {
          onAdd(v.trim());
          setV("");
        }
      }}
    />
  );
}

function SuggestedVines({ t }: { t: Thought }) {
  const thoughts = useStore((s) => s.thoughts);
  const limbs = useStore((s) => s.limbs);
  const links = useStore((s) => s.links);
  const dismissed = useStore((s) => s.dismissedVines);
  const list = useMemo(() => suggestVines(thoughts, Object.values(links), t.id, dismissed), [thoughts, links, t.id, dismissed]);
  if (!list.length) return null;
  const st = useStore.getState;
  return (
    <div className="suggest">
      <div className="suggest-h mono">Maybe related</div>
      {list.map(({ thought: o, reasons }) => (
        <div key={o.id} className="list-item suggest-item" style={{ "--c": limbColorOf(thoughts, limbs, o) } as React.CSSProperties}>
          <span style={{ color: "var(--c)", opacity: 0.6 }}>⟿</span>
          <span className="grow" onClick={() => st().select(o.id, { open: true })} title={o.title}>
            {o.title || "untitled"}
            <small className="crumb" style={{ display: "block" }}>
              {reasons.join(" · ")}
            </small>
          </span>
          <button className="btn small" onClick={() => st().addLink(t.id, o.id)} title="Grow this vine">
            + Vine
          </button>
          <button className="x" onClick={() => st().dismissVine(t.id, o.id)} aria-label="Not related" title="Not related">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
