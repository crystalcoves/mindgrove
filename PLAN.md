# Mindgrove — design brief

A personal thought tree: capture, record and map thoughts and ideas. It starts as a
trunk and keeps growing — each thought is a branch, follow-ups are sub-branches/twigs.

## Principles
1. **Capture in under 3 seconds.** Friction kills the habit.
2. **Two views of the same data.**
   - **2D (default, "Grove")** — clean, fast, keyboard-first outline: search, filter, edit.
     This is where daily use happens. Calm, uncluttered.
   - **3D ("Canopy")** — detailed, immersive holographic tree for exploring and inspiration.
3. **Local-first, never locked in.** Works offline; Markdown export always available.
4. **Visual reference: BruNet** (https://github.com/crystalcoves/BruNet) — reuse its holo
   look (see `static/domain.css` hub-panel holo style, `static/js/domain.js` canvas world,
   `static/js/fx.js` juice/particles, settings for reduced motion/particles). Match the feel,
   don't copy game-specific code.

## Metaphor
| Tree part | Meaning |
|---|---|
| Trunk | You |
| Limbs | Themes / domains (user-created) |
| Branches → twigs | A thought → its follow-ups (unlimited depth) |
| Seeds | Quick-captured thoughts not yet placed (inbox) |
| Vines | Cross-links between thoughts on different branches |
| Blossoms / fruit | Thought became an action / done |
| Wilting | Untouched for N weeks → fades, nudges revisit or prune |
| Growth rings / time scrubber | Replay the tree growing over time |

Status per thought: `seed → growing → blooming → dormant → pruned`.

## Stack
Vite + React + TypeScript · react-three-fiber + drei + @react-three/postprocessing (bloom) ·
Zustand · Dexie (IndexedDB) · vite-plugin-pwa · Vitest. Deploy: GitHub Pages or Vercel.
3D perf: instanced meshes, LOD, target thousands of nodes at 60fps.

## Phase 1 (build now)
- Data model: `Thought {id, parentId|null, limbId|null, title, body(md), status, tags[],
  createdAt, updatedAt, touchedAt}`, `Link {from, to}`, `Limb {id, name, color}`.
- Quick capture: global hotkey (Ctrl/Cmd+Space or `/`) → single input → Enter drops a seed.
  Command palette (Ctrl+K) for navigation/actions.
- 2D Grove: collapsible outline by limb, drag to re-parent, inline edit, status chips,
  search + filters (status, tag, limb, wilting), keyboard nav (↑↓ ←→ Tab/Shift+Tab, Enter).
- Detail panel: markdown body, follow-ups, links, history dates.
- 3D Canopy: procedural tree (trunk → limbs → branches → twigs) with stable seeded layout
  (existing nodes never jump when new ones are added), animated growth for new nodes,
  holographic shader + bloom + drifting particles, orbit/fly camera, click a node to
  focus + open detail panel, hover labels, vines as glowing curves, wilting = desaturate/fade.
- Toggle 2D/3D instantly (key `V`), selection shared between views.
- Settings: theme (cyan holo / bioluminescent / aurora), reduced motion, particles off.
- Export/import: Markdown (one file per limb) + JSON backup.
- PWA installable, offline.
- Tests for the store, tree layout stability, export round-trip.

## Later
- v2: time-lapse replay, wilting reminders, vine suggestions.
- v3: voice capture, share-target on mobile, optional sync (Supabase).
- AI placement (Claude suggests branch/links) — **deferred by the owner, do not build yet.**
