import { useEffect, useMemo, useRef, useState } from "react";
import { downloadBackup, downloadMarkdown } from "../io/files";
import { fuzzy } from "../lib/keys";
import { ancestors, byOrder, childrenIndex, descendants } from "../model/tree";
import { STATUSES, STATUS_META, type ThemeName } from "../model/types";
import { truncate, useStore } from "../store/store";
import { THEMES } from "./themes";
import { pickImport } from "./SettingsPanel";
import { openVoice } from "../voice/engine";
import { openReflect } from "./Reflect";

interface Item {
  id: string;
  group: string;
  icon: string;
  title: string;
  sub?: string;
  keys?: string;
  run: () => void;
}

export function Palette() {
  const open = useStore((s) => s.paletteOpen);
  if (!open) return null;
  return <PaletteBox />;
}

function PaletteBox() {
  const mode = useStore((s) => s.paletteMode);
  const thoughts = useStore((s) => s.thoughts);
  const limbs = useStore((s) => s.limbs);
  const selectedId = useStore((s) => s.selectedId);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const st = useStore.getState;
  const close = () => st().openPalette(false);
  const sel = selectedId ? thoughts[selectedId] : null;

  const crumb = (id: string) => {
    const chain = ancestors(thoughts, id);
    const root = chain[0] ?? thoughts[id];
    const limb = root?.limbId ? limbs[root.limbId]?.name : "Seeds";
    return [limb, ...chain.map((a) => truncate(a.title, 18))].join(" › ");
  };

  const items = useMemo<Item[]>(() => {
    const thoughtItems = (filter: (id: string) => boolean, run: (id: string) => void, group = "Thoughts"): Item[] =>
      Object.values(thoughts)
        .filter((t) => filter(t.id))
        .sort((a, b) => b.touchedAt - a.touchedAt)
        .map((t) => ({
          id: t.id,
          group,
          icon: STATUS_META[t.status].glyph,
          title: t.title || "untitled",
          sub: crumb(t.id),
          run: () => run(t.id),
        }));

    if (mode === "link" && sel) {
      const linked = new Set(Object.values(st().links).flatMap((l) => (l.from === sel.id ? [l.to] : l.to === sel.id ? [l.from] : [])));
      return thoughtItems(
        (id) => id !== sel.id && !linked.has(id),
        (id) => {
          st().addLink(sel.id, id);
          st().toast(`Vine grown to “${truncate(thoughts[id].title, 36)}”`);
        },
        "Grow a vine to…",
      );
    }
    if (mode === "move" && sel) {
      const blocked = new Set([sel.id, ...descendants(childrenIndex(thoughts), sel.id).map((t) => t.id)]);
      const dest: Item[] = [
        {
          id: "seeds",
          group: "Move to…",
          icon: "◦",
          title: "Seeds · inbox",
          run: () => st().move(sel.id, { parentId: null, limbId: null }),
        },
        ...Object.values(limbs)
          .sort(byOrder)
          .map((l) => ({
            id: l.id,
            group: "Move to…",
            icon: "❘",
            title: `Limb · ${l.name}`,
            sub: "as a branch",
            run: () => st().move(sel.id, { parentId: null, limbId: l.id }),
          })),
      ];
      return [
        ...dest,
        ...thoughtItems(
          (id) => !blocked.has(id),
          (id) => {
            st().move(sel.id, { parentId: id, limbId: null });
            st().toggleCollapsed(id, false);
          },
          "Move under…",
        ),
      ];
    }

    const cmds: Item[] = [
      { id: "c-capture", group: "Actions", icon: "✦", title: "Capture a thought", keys: "/", run: () => st().openCapture(true) },
      {
        id: "c-view",
        group: "Actions",
        icon: "◈",
        title: st().view === "grove" ? "Switch to Canopy (3D)" : "Switch to Grove (outline)",
        keys: "V",
        run: () => st().toggleView(),
      },
      {
        id: "c-limb",
        group: "Actions",
        icon: "❘",
        title: "New limb…",
        run: () => {
          const name = prompt("Name the new limb (a theme or domain)");
          if (name?.trim()) st().addLimb(name.trim());
        },
      },
      { id: "c-voice", group: "Actions", icon: "🎙", title: "Transcribe a voice note…", run: () => openVoice(true) },
      { id: "c-reflect", group: "Actions", icon: "☼", title: "Reflect now…", run: () => openReflect("prompt") },
      { id: "c-week", group: "Actions", icon: "↟", title: "What grew this week…", run: () => openReflect("week") },
      { id: "c-tend", group: "Actions", icon: "❦", title: "Tend wilting thoughts…", keys: "W", run: () => st().openTend(true) },
      { id: "c-wilt", group: "Filters", icon: "❦", title: "Show wilting thoughts", run: () => st().setFilters({ wilting: true }) },
      ...STATUSES.map((s) => ({
        id: `f-${s}`,
        group: "Filters",
        icon: STATUS_META[s].glyph,
        title: `Show only ${STATUS_META[s].label.toLowerCase()}`,
        run: () => st().setFilters({ statuses: [s] }),
      })),
      { id: "c-clear", group: "Filters", icon: "✕", title: "Clear filters", keys: "Esc", run: () => st().clearFilters() },
      {
        id: "c-collapse",
        group: "Actions",
        icon: "▸",
        title: "Collapse all",
        run: () => {
          const all: Record<string, boolean> = { seeds: true };
          for (const l of Object.values(limbs)) all[`limb:${l.id}`] = true;
          useStore.setState({ collapsed: all });
        },
      },
      { id: "c-expand", group: "Actions", icon: "▾", title: "Expand all", run: () => useStore.setState({ collapsed: {} }) },
      {
        id: "c-md",
        group: "Data",
        icon: "⇩",
        title: "Export Markdown (.zip, one file per limb)",
        run: () => downloadMarkdown(st().snapshot()),
      },
      { id: "c-json", group: "Data", icon: "⇩", title: "Export JSON backup", run: () => downloadBackup(st().snapshot(), st().settings) },
      { id: "c-import", group: "Data", icon: "⇧", title: "Import Markdown / JSON…", run: () => pickImport("merge") },
      { id: "c-settings", group: "Settings", icon: "⚙", title: "Settings & shortcuts", keys: "?", run: () => st().openSettings(true) },
      ...(Object.keys(THEMES) as ThemeName[]).map((k) => ({
        id: `t-${k}`,
        group: "Settings",
        icon: "◐",
        title: `Theme: ${THEMES[k].label}`,
        run: () => st().setSettings({ theme: k }),
      })),
      {
        id: "c-motion",
        group: "Settings",
        icon: "≋",
        title: st().settings.reducedMotion ? "Enable motion" : "Reduce motion",
        run: () => st().setSettings({ reducedMotion: !st().settings.reducedMotion }),
      },
    ];
    if (sel) {
      cmds.unshift(
        {
          id: "s-follow",
          group: `“${truncate(sel.title, 30)}”`,
          icon: "↳",
          title: "Add follow-up",
          keys: "N",
          run: () => {
            st().setView("grove");
            st().sprout(sel.id, "child");
          },
        },
        {
          id: "s-move",
          group: `“${truncate(sel.title, 30)}”`,
          icon: "⇄",
          title: "Move to…",
          keys: "M",
          run: () => st().openPalette(true, "move"),
        },
        {
          id: "s-link",
          group: `“${truncate(sel.title, 30)}”`,
          icon: "⟿",
          title: "Grow a vine to…",
          keys: "L",
          run: () => st().openPalette(true, "link"),
        },
        ...STATUSES.filter((s) => s !== sel.status).map((s) => ({
          id: `s-${s}`,
          group: `“${truncate(sel.title, 30)}”`,
          icon: STATUS_META[s].glyph,
          title: `Mark ${STATUS_META[s].label.toLowerCase()}`,
          run: () => st().setStatus(sel.id, s),
        })),
      );
    }
    const go = thoughtItems(
      () => true,
      (id) => st().select(id, { open: true }),
      "Go to thought",
    );
    return [...cmds, ...go];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, thoughts, limbs, sel?.id]);

  const shown = useMemo(() => {
    if (!q.trim()) {
      // Commands first, then the 12 most recently touched thoughts.
      const cmds = items.filter((i) => !i.group.startsWith("Go to"));
      const go = items.filter((i) => i.group.startsWith("Go to")).slice(0, 12);
      return mode === "go" ? [...cmds, ...go] : items.slice(0, 60);
    }
    return items
      .map((i) => ({ i, s: Math.max(fuzzy(q, i.title), fuzzy(q, `${i.title} ${i.sub ?? ""}`) - 50) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 60)
      .map((x) => x.i);
  }, [items, q, mode]);

  useEffect(() => setCursor(0), [q, mode]);
  useEffect(() => {
    listRef.current?.querySelector(".p-item.on")?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const run = (item?: Item) => {
    if (!item) return;
    close();
    item.run();
  };

  const placeholder =
    mode === "link"
      ? "Grow a vine from this thought to…"
      : mode === "move"
        ? "Move this thought to a limb or under another thought…"
        : "Type a command or search your thoughts…";

  let lastGroup = "";
  return (
    <div className="scrim fade" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette panel in" role="dialog" aria-label="Command palette">
        {mode !== "go" && sel && (
          <div className="p-mode label amber">
            {mode === "link" ? "Vine" : "Move"} · {truncate(sel.title, 50)}
          </div>
        )}
        <input
          className="p-in"
          autoFocus
          value={q}
          placeholder={placeholder}
          aria-label="Command"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setCursor((c) => Math.min(shown.length - 1, c + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setCursor((c) => Math.max(0, c - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              run(shown[cursor]);
            } else if (e.key === "Escape") {
              e.preventDefault();
              close();
            }
          }}
        />
        <div className="p-list" ref={listRef} role="listbox">
          {shown.length === 0 && <div className="p-empty">No matches</div>}
          {shown.map((item, n) => {
            const head = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            return (
              <div key={item.group + item.id}>
                {head && <div className="p-group">{head}</div>}
                <div
                  className={`p-item${n === cursor ? " on" : ""}`}
                  role="option"
                  aria-selected={n === cursor}
                  onMouseMove={() => setCursor(n)}
                  onClick={() => run(item)}
                >
                  <span className="ico">{item.icon}</span>
                  <span className="grow">{item.title}</span>
                  {item.sub && <span className="sub">{item.sub}</span>}
                  {item.keys && <kbd>{item.keys}</kbd>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
