import { useEffect, useRef } from "react";
import { thoughtRows, useVisibleItems } from "../grove/rows";
import { isTyping } from "../lib/keys";
import { useStore } from "../store/store";
import { openVoice, useVoice } from "../voice/engine";

/** Global shortcuts. Outline navigation works in both views — selection is shared. */
export function useHotkeys() {
  const { items } = useVisibleItems();
  const rowsRef = useRef(thoughtRows(items));
  rowsRef.current = thoughtRows(items);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key;

      // Always-on shortcuts.
      if (mod && (k === "k" || k === "K")) {
        e.preventDefault();
        st.openPalette(!st.paletteOpen);
        return;
      }
      if (mod && k === " ") {
        e.preventDefault();
        st.openCapture(true);
        return;
      }
      if (mod && (k === "e" || k === "E") && e.shiftKey) {
        e.preventDefault();
        st.openSettings(true);
        return;
      }

      const voiceOpen = useVoice.getState().open;
      const overlay = st.captureOpen || st.paletteOpen || st.settingsOpen || st.tendOpen || voiceOpen;
      // Escape closes a panel even when focus has fallen back to the page.
      if (k === "Escape" && (st.settingsOpen || st.tendOpen || voiceOpen)) {
        st.openSettings(false);
        st.openTend(false);
        openVoice(false);
        return;
      }
      if (overlay || isTyping(e) || st.editingId) return;

      if (k === "Escape") {
        if (st.filters.query || st.filters.statuses.length || st.filters.tag || st.filters.limbId || st.filters.wilting) st.clearFilters();
        else if (st.detailOpen) st.openDetail(false);
        else st.select(null);
        return;
      }
      if (mod || (e.altKey && k !== "ArrowUp" && k !== "ArrowDown")) return;

      const rows = rowsRef.current;
      const sel = st.selectedId ? st.thoughts[st.selectedId] : null;
      const i = sel ? rows.findIndex((r) => r.thought.id === sel.id) : -1;
      const go = (j: number) => {
        const r = rows[Math.max(0, Math.min(rows.length - 1, j))];
        if (r) st.select(r.thought.id);
      };

      switch (k) {
        case "/":
          e.preventDefault();
          st.openCapture(true);
          return;
        case "v":
        case "V":
          st.toggleView();
          return;
        case "?":
          st.openSettings(true);
          return;
        case "w":
        case "W":
          st.openTend(true);
          return;
        case "ArrowDown":
        case "j":
          e.preventDefault();
          if (e.altKey && sel) st.nudge(sel.id, 1);
          else go(i + 1);
          return;
        case "ArrowUp":
        case "k":
          e.preventDefault();
          if (e.altKey && sel) st.nudge(sel.id, -1);
          else go(i === -1 ? rows.length - 1 : i - 1);
          return;
        case "Home":
          e.preventDefault();
          go(0);
          return;
        case "End":
          e.preventDefault();
          go(rows.length - 1);
          return;
      }

      if (k === "o" || k === "O") {
        e.preventDefault();
        if (st.view === "canopy") st.setView("grove");
        st.sprout(sel?.id ?? null, "sibling");
        return;
      }

      if (!sel) return;
      const row = rows[i];
      switch (k) {
        case "ArrowRight":
          e.preventDefault();
          if (row?.hasChildren && row.collapsed) st.toggleCollapsed(sel.id, false);
          else if (row?.hasChildren) go(i + 1);
          return;
        case "ArrowLeft":
          e.preventDefault();
          if (row?.hasChildren && !row.collapsed) st.toggleCollapsed(sel.id, true);
          else if (sel.parentId) st.select(sel.parentId);
          return;
        case "Enter":
          e.preventDefault();
          if (st.view === "grove") st.setEditing(sel.id);
          else st.openDetail(true);
          return;
        case " ":
          e.preventDefault();
          st.openDetail(!st.detailOpen);
          return;
        case "Tab":
          e.preventDefault();
          if (e.shiftKey) st.outdent(sel.id);
          else st.indent(sel.id);
          return;
        case "n":
        case "N":
          e.preventDefault();
          if (st.view === "canopy") st.setView("grove");
          st.sprout(sel.id, "child");
          return;
        case "s":
        case "S":
          st.cycleStatus(sel.id, e.shiftKey ? -1 : 1);
          return;
        case "x":
        case "X":
          st.setStatus(sel.id, sel.status === "pruned" ? "growing" : "pruned");
          return;
        case "m":
        case "M":
          e.preventDefault();
          st.openPalette(true, "move");
          return;
        case "l":
        case "L":
          e.preventDefault();
          st.openPalette(true, "link");
          return;
        case "Delete":
        case "Backspace":
          e.preventDefault();
          st.remove(sel.id);
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
