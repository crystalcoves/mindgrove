import { useEffect, useRef, useState } from "react";
import { burstEl } from "../lib/fx";
import { MOD } from "../lib/keys";
import { parseCapture } from "../model/tree";
import { truncate, useStore } from "../store/store";

/** The < 3 second path: one input, Enter drops a seed. */
export function Capture() {
  const open = useStore((s) => s.captureOpen);
  if (!open) return null;
  return <CaptureBox />;
}

function CaptureBox() {
  const [text, setText] = useState("");
  const selected = useStore((s) => (s.selectedId ? s.thoughts[s.selectedId] : null));
  const [asFollowUp, setAsFollowUp] = useState(false);
  const [count, setCount] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const close = () => useStore.getState().openCapture(false);

  useEffect(() => {
    input.current?.focus();
  }, []);

  const { tags } = parseCapture(text);

  const submit = (keepOpen: boolean) => {
    const st = useStore.getState();
    const id = st.capture(text, asFollowUp && selected ? { parentId: selected.id } : {});
    if (!id) return;
    burstEl(input.current, { n: 26 });
    setText("");
    setCount((c) => c + 1);
    if (asFollowUp && selected) st.toggleCollapsed(selected.id, false);
    if (!keepOpen) {
      close();
      st.toast(asFollowUp && selected ? `Twig added to “${truncate(selected.title, 32)}”` : "Seed dropped in the inbox", {
        label: "Open",
        run: () => useStore.getState().select(id, { open: true }),
      });
    }
  };

  return (
    <div className="scrim fade" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="capture panel in" role="dialog" aria-label="Quick capture">
        <div className="label amber">Drop a seed</div>
        <input
          ref={input}
          className="cap-in"
          value={text}
          placeholder="What's on your mind?"
          aria-label="Thought"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit(e.shiftKey);
            } else if (e.key === "Escape") {
              e.preventDefault();
              close();
            } else if (e.key === "Tab" && selected) {
              e.preventDefault();
              setAsFollowUp((v) => !v);
            }
          }}
        />
        <div className="cap-tags">
          {tags.map((t) => (
            <span key={t} className="tag">
              #{t}
            </span>
          ))}
          {count > 0 && (
            <span className="dim mono" style={{ fontSize: 11 }}>
              {count} captured this session
            </span>
          )}
        </div>
        <div className="cap-row">
          <span className="grow" />
          {selected && (
            <button className={`chip${asFollowUp ? " on" : ""}`} onClick={() => setAsFollowUp((v) => !v)} title="Tab toggles">
              <span className="cap-where">{asFollowUp ? `↳ follow-up of “${truncate(selected.title, 38)}”` : "◦ into Seeds inbox"}</span>
              <kbd>Tab</kbd>
            </button>
          )}
        </div>
        <div className="cap-row dim mono" style={{ fontSize: 11 }}>
          <span>
            <kbd>Enter</kbd> drop
          </span>
          <span>
            <kbd>Shift</kbd>+<kbd>Enter</kbd> drop &amp; keep going
          </span>
          <span>
            <kbd>#tag</kbd> inline
          </span>
          <span className="grow" />
          <span>
            <kbd>/</kbd> or <kbd>{MOD}</kbd>+<kbd>Space</kbd> anywhere
          </span>
        </div>
      </div>
    </div>
  );
}
