import { memo, useEffect, useRef, useState, type DragEvent } from "react";
import { allTags, isWilting } from "../model/tree";
import { STATUSES, STATUS_META, type Limb, type Thought } from "../model/types";
import { relTime } from "../lib/keys";
import { useStore } from "../store/store";
import { STATUS_COLORS } from "../ui/themes";
import { useVisibleItems, type Item, type Row } from "./rows";

type Drop = { id: string; pos: "before" | "after" | "child" } | { head: string } | null;

export function Grove() {
  const { items, filtering } = useVisibleItems();
  const [drop, setDrop] = useState<Drop>(null);
  const dragId = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const selectedId = useStore((s) => s.selectedId);

  // Keep the selected row in view as the keyboard moves it.
  useEffect(() => {
    if (!selectedId) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-id="${selectedId}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedId, items]);

  const onDragEnd = () => {
    dragId.current = null;
    setDrop(null);
  };

  const dropOnRow = (e: DragEvent, row: Row) => {
    e.preventDefault();
    const id = dragId.current;
    const st = useStore.getState();
    if (!id || id === row.thought.id || !drop || !("pos" in drop)) return onDragEnd();
    const target = row.thought;
    let ok = true;
    if (drop.pos === "child") {
      ok = st.move(id, { parentId: target.id, limbId: null });
      st.toggleCollapsed(target.id, false);
    } else {
      const place = { parentId: target.parentId, limbId: target.limbId };
      if (drop.pos === "before") ok = st.move(id, place, target.id);
      else {
        const sibs = items.filter(
          (i): i is Row => i.kind === "thought" && i.thought.parentId === target.parentId && i.thought.limbId === target.limbId,
        );
        const next = sibs[sibs.findIndex((r) => r.thought.id === target.id) + 1];
        ok = st.move(id, place, next?.thought.id ?? null);
      }
    }
    if (!ok) st.toast("Can't plant a thought inside its own follow-ups");
    else st.select(id);
    onDragEnd();
  };

  const dropOnHead = (e: DragEvent, head: string) => {
    e.preventDefault();
    const id = dragId.current;
    if (id) {
      const st = useStore.getState();
      st.move(id, head === "seeds" ? { parentId: null, limbId: null } : { parentId: null, limbId: head });
      st.toggleCollapsed(head === "seeds" ? "seeds" : `limb:${head}`, false);
      st.select(id);
    }
    onDragEnd();
  };

  return (
    <div className="grove">
      <FilterBar />
      <div className="outline" ref={listRef} role="tree" aria-label="Thought outline" onDragEnd={onDragEnd}>
        {filtering && items.length === 0 && (
          <div className="o-empty">
            Nothing matches. <kbd>Esc</kbd> clears the search.
          </div>
        )}
        {items.map((item) =>
          item.kind === "thought" ? (
            <RowView
              key={item.thought.id}
              row={item}
              drop={drop && "id" in drop && drop.id === item.thought.id ? drop.pos : null}
              onDragStart={(id) => (dragId.current = id)}
              onDragOver={(e, pos) => {
                if (!dragId.current) return;
                e.preventDefault();
                setDrop({ id: item.thought.id, pos });
              }}
              onDrop={(e) => dropOnRow(e, item)}
            />
          ) : (
            <Header
              key={item.kind === "limb" ? item.limb!.id : "seeds"}
              item={item}
              dropping={!!drop && "head" in drop && drop.head === (item.limb?.id ?? "seeds")}
              onDragOver={(e) => {
                if (!dragId.current) return;
                e.preventDefault();
                setDrop({ head: item.limb?.id ?? "seeds" });
              }}
              onDrop={(e) => dropOnHead(e, item.limb?.id ?? "seeds")}
            />
          ),
        )}
        {!filtering && <NewLimb />}
      </div>
      <div className="hint-bar">
        <span>
          <kbd>/</kbd> capture
        </span>
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> move
        </span>
        <span>
          <kbd>←</kbd>
          <kbd>→</kbd> fold
        </span>
        <span>
          <kbd>Enter</kbd> edit
        </span>
        <span>
          <kbd>O</kbd> new · <kbd>N</kbd> follow-up
        </span>
        <span>
          <kbd>Tab</kbd> nest
        </span>
        <span>
          <kbd>S</kbd> status
        </span>
        <span>
          <kbd>M</kbd> move · <kbd>L</kbd> link
        </span>
        <span>
          <kbd>V</kbd> canopy
        </span>
        <span>
          <kbd>Ctrl</kbd>
          <kbd>K</kbd> commands
        </span>
      </div>
    </div>
  );
}

function FilterBar() {
  const filters = useStore((s) => s.filters);
  const setFilters = useStore((s) => s.setFilters);
  const clear = useStore((s) => s.clearFilters);
  const limbs = useStore((s) => s.limbs);
  const thoughts = useStore((s) => s.thoughts);
  const hidePruned = useStore((s) => s.hidePruned);
  const setHidePruned = useStore((s) => s.setHidePruned);
  const tags = allTags(thoughts);
  const any = filters.statuses.length || filters.tag || filters.limbId || filters.wilting || filters.query;

  return (
    <div className="filters" role="toolbar" aria-label="Filters">
      {STATUSES.map((st) => {
        const on = filters.statuses.includes(st);
        return (
          <button
            key={st}
            className={`chip${on ? " on" : ""}`}
            style={{ "--c": STATUS_COLORS[st] } as React.CSSProperties}
            aria-pressed={on}
            title={STATUS_META[st].hint}
            onClick={() => setFilters({ statuses: on ? filters.statuses.filter((x) => x !== st) : [...filters.statuses, st] })}
          >
            <i>{STATUS_META[st].glyph}</i>
            {STATUS_META[st].label}
          </button>
        );
      })}
      <span className="sep" />
      <button
        className={`chip${filters.wilting ? " on" : ""}`}
        style={{ "--c": "#d9b36a" } as React.CSSProperties}
        aria-pressed={filters.wilting}
        onClick={() => setFilters({ wilting: !filters.wilting })}
      >
        <i>❦</i>Wilting
      </button>
      <select
        className="input"
        value={filters.limbId ?? ""}
        onChange={(e) => setFilters({ limbId: e.target.value || null })}
        aria-label="Filter by limb"
      >
        <option value="">All limbs</option>
        {Object.values(limbs)
          .sort((a, b) => a.order - b.order)
          .map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
      </select>
      <select
        className="input"
        value={filters.tag ?? ""}
        onChange={(e) => setFilters({ tag: e.target.value || null })}
        aria-label="Filter by tag"
      >
        <option value="">All tags</option>
        {tags.map((t) => (
          <option key={t} value={t}>
            #{t}
          </option>
        ))}
      </select>
      <button
        className={`chip${!hidePruned ? " on" : ""}`}
        aria-pressed={!hidePruned}
        onClick={() => setHidePruned(!hidePruned)}
        title="Show pruned thoughts in the outline"
      >
        Show pruned
      </button>
      {any ? (
        <button className="btn ghost small" onClick={clear}>
          Clear ✕
        </button>
      ) : null}
    </div>
  );
}

function Header({
  item,
  dropping,
  onDragOver,
  onDrop,
}: {
  item: Item & { kind: "limb" | "seeds" };
  dropping: boolean;
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
}) {
  const toggle = useStore((s) => s.toggleCollapsed);
  const limb = item.limb as Limb | undefined;
  const key = limb ? `limb:${limb.id}` : "seeds";
  const color = limb?.color ?? "#9fb4c2";
  const addHere = (e: React.MouseEvent) => {
    e.stopPropagation();
    const st = useStore.getState();
    if (limb) {
      const t = st.addThought({ title: "", limbId: limb.id, status: "growing" });
      st.toggleCollapsed(key, false);
      st.select(t.id);
      st.setEditing(t.id, true);
    } else st.openCapture(true);
  };
  return (
    <>
      <div
        className={`o-head${dropping ? " drop" : ""}`}
        style={{ "--c": color } as React.CSSProperties}
        onClick={() => toggle(key)}
        onDragOver={onDragOver}
        onDrop={onDrop}
        role="treeitem"
        aria-expanded={!item.collapsed}
      >
        <span className="caret">{item.collapsed ? "▸" : "▾"}</span>
        {limb ? <span className="dot" /> : <span className="caret">◦</span>}
        <span className="name">{limb ? limb.name : "Seeds · inbox"}</span>
        <span className="count">{item.count}</span>
        <span className="rule" />
        <button className="btn ghost small add" onClick={addHere} title={limb ? `Add a branch to ${limb.name}` : "Capture a seed"}>
          + {limb ? "Branch" : "Seed"}
        </button>
      </div>
      {!item.collapsed && item.count === 0 && (
        <div className="o-empty">
          {limb ? "Empty limb — drag a seed here or press + Branch." : "Inbox zero. Press / to capture a thought."}
        </div>
      )}
    </>
  );
}

interface RowProps {
  row: Row;
  drop: "before" | "after" | "child" | null;
  onDragStart: (id: string) => void;
  onDragOver: (e: DragEvent, pos: "before" | "after" | "child") => void;
  onDrop: (e: DragEvent) => void;
}

const RowView = memo(function RowView({ row, drop, onDragStart, onDragOver, onDrop }: RowProps) {
  const t = row.thought;
  const selected = useStore((s) => s.selectedId === t.id);
  const editing = useStore((s) => s.editingId === t.id);
  const wiltWeeks = useStore((s) => s.settings.wiltWeeks);
  const vines = useStore((s) => {
    let n = 0;
    for (const l of Object.values(s.links)) if (l.from === t.id || l.to === t.id) n++;
    return n;
  });
  const color = useStore((s) => limbColorOf(s.thoughts, s.limbs, t));
  const born = useStore((s) => s.births[t.id]);
  const [dragging, setDragging] = useState(false);
  const wilting = isWilting(t, Date.now(), wiltWeeks);
  const st = useStore.getState;

  const cls = [
    "row",
    selected && "sel",
    wilting && "wilt",
    t.status === "pruned" && "pruned",
    drop && `drop-${drop}`,
    dragging && "dragging",
    born && performance.now() - born < 1500 && "born",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={cls}
      data-id={t.id}
      role="treeitem"
      aria-selected={selected}
      aria-expanded={row.hasChildren ? !row.collapsed : undefined}
      aria-level={row.depth + 1}
      style={{ "--d": row.depth, "--c": color, "--guide": row.depth ? "block" : "none" } as React.CSSProperties}
      draggable={!editing}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", t.title);
        onDragStart(t.id);
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      onDragOver={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const y = (e.clientY - r.top) / r.height;
        onDragOver(e, y < 0.28 ? "before" : y > 0.72 ? "after" : "child");
      }}
      onDrop={onDrop}
      onClick={() => st().select(t.id, { open: true })}
      onDoubleClick={() => st().setEditing(t.id)}
    >
      <button
        className={`caret${row.hasChildren ? "" : " leaf"}`}
        tabIndex={-1}
        aria-label={row.collapsed ? "Expand" : "Collapse"}
        onClick={(e) => {
          e.stopPropagation();
          if (row.hasChildren) st().toggleCollapsed(t.id);
        }}
      >
        {row.hasChildren ? (row.collapsed ? "▸" : "▾") : "●"}
      </button>
      <button
        className="status"
        tabIndex={-1}
        style={{ "--sc": STATUS_COLORS[t.status] } as React.CSSProperties}
        title={`${STATUS_META[t.status].label} — click to cycle`}
        onClick={(e) => {
          e.stopPropagation();
          st().cycleStatus(t.id);
        }}
      >
        {STATUS_META[t.status].glyph}
      </button>
      {editing ? <TitleEditor thought={t} /> : <span className="title">{t.title || <span className="dim">untitled</span>}</span>}
      <span className="meta">
        {row.crumb && <span className="crumb">{row.crumb}</span>}
        {t.tags.slice(0, 3).map((tag) => (
          <span key={tag} className="tag">
            #{tag}
          </span>
        ))}
        {vines > 0 && (
          <span className="vines" title={`${vines} vine${vines > 1 ? "s" : ""}`}>
            ⟿{vines}
          </span>
        )}
        {row.hasChildren && row.collapsed && !row.crumb && <span className="kids">+{countHidden(t.id)}</span>}
        <span className="age" title="Last touched">
          {relTime(t.touchedAt)}
        </span>
      </span>
    </div>
  );
});

function countHidden(id: string) {
  const { thoughts } = useStore.getState();
  let n = 0;
  for (const t of Object.values(thoughts)) if (t.parentId === id) n++;
  return n;
}

export function limbColorOf(thoughts: Record<string, Thought>, limbs: Record<string, Limb>, t: Thought): string {
  let cur: Thought | undefined = t;
  const seen = new Set<string>();
  while (cur?.parentId && thoughts[cur.parentId] && !seen.has(cur.id)) {
    seen.add(cur.id);
    cur = thoughts[cur.parentId];
  }
  return (cur?.limbId && limbs[cur.limbId]?.color) || "#9fb4c2";
}

function TitleEditor({ thought }: { thought: Thought }) {
  const [value, setValue] = useState(thought.title);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const commit = (next?: "flow" | "cancel") => {
    if (done.current) return;
    done.current = true;
    const st = useStore.getState();
    const title = value.trim();
    if (next === "cancel") {
      if (!thought.title && st.editFlow) st.remove(thought.id, { silent: true });
      st.setEditing(null);
      return;
    }
    if (!title) {
      if (!thought.title) st.remove(thought.id, { silent: true });
      st.setEditing(null);
      return;
    }
    if (title !== thought.title) st.update(thought.id, { title });
    if (next === "flow" && st.editFlow) st.sprout(thought.id, "sibling");
    else st.setEditing(null);
  };

  return (
    <input
      ref={ref}
      className="title-in"
      value={value}
      aria-label="Thought title"
      placeholder="Name this thought…"
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => commit()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          commit("flow");
        } else if (e.key === "Escape") {
          e.preventDefault();
          commit("cancel");
        } else if (e.key === "Tab") {
          e.preventDefault();
          const st = useStore.getState();
          if (value.trim() && value.trim() !== thought.title) st.update(thought.id, { title: value.trim() });
          if (e.shiftKey) st.outdent(thought.id);
          else st.indent(thought.id);
          // Re-mounts in its new position; keep editing there.
          done.current = true;
          const flow = st.editFlow;
          st.setEditing(null);
          requestAnimationFrame(() => st.setEditing(thought.id, flow));
        }
      }}
    />
  );
}

function NewLimb() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const add = () => {
    const n = name.trim();
    if (n) {
      const st = useStore.getState();
      st.addLimb(n);
      st.toast(`New limb “${n}” grows from the trunk`);
    }
    setName("");
    setOpen(false);
  };
  return open ? (
    <div className="o-head" style={{ cursor: "default" }}>
      <input
        className="input"
        autoFocus
        placeholder="Name a theme — Work, Health, Someday…"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={add}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") add();
          if (e.key === "Escape") setOpen(false);
        }}
      />
    </div>
  ) : (
    <button className="btn ghost" style={{ marginTop: 18 }} onClick={() => setOpen(true)}>
      + New limb
    </button>
  );
}
