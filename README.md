# Mindgrove

A living tree of your thoughts. Capture a thought in under three seconds, then watch it grow into branches and twigs in a clean outline (the **Grove**) or explore it as an immersive holographic tree (the **Canopy**).

![The Canopy: a holographic 3D thought tree](docs/screenshots/canopy.png)

| Grove (everyday use) | Canopy focus |
| --- | --- |
| ![Grove outline with detail panel](docs/screenshots/grove.png) | ![Canopy focused on a thought](docs/screenshots/canopy-focus.png) |
| **Quick capture** | **Command palette** |
| ![Quick capture](docs/screenshots/capture.png) | ![Command palette](docs/screenshots/palette.png) |
| **Themes** | **Phone** |
| ![Bioluminescent theme](docs/screenshots/canopy-biolume.png) | <img src="docs/screenshots/mobile.png" width="180" alt="Grove on a phone"> <img src="docs/screenshots/mobile-canopy.png" width="180" alt="Canopy on a phone"> |

## The metaphor

| Tree part | Meaning |
| --- | --- |
| Trunk | You |
| Limbs | Themes / domains you create (Work, Life, Ideas…) |
| Branches → sub-branches | A thought → its follow-ups, any depth. Branches are bold with a limb-coloured spine and round buds; sub-branches are paler, with diamond buds in the Canopy |
| Seeds | Quick captures waiting in the inbox |
| Vines | Links between thoughts on different branches |
| Blossoms | A thought that became an action, or is done |
| Wilting | Untouched for a few weeks: it fades until you revive or prune it |

Every thought has a status: `seed → growing → blooming → dormant → pruned`.

## Using it

- **Capture:** press `/` (or `Ctrl/⌘+Space`) anywhere, type, then press `Enter`. Tap **Voice** to speak instead (Chrome, Edge, Safari). On Android you can also use **Share → Mindgrove** from any app to drop a seed. Add `#tags` inline. `Shift+Enter` keeps the box open so you can dump several thoughts in a row. `Tab` files the thought as a follow-up of the one you have selected. On a phone, use the ＋ button.
- **Grove:** a keyboard-first outline, grouped by limb.
  - `↑ ↓` move · `← →` fold, unfold, or jump to parent · `Enter` rename · `Space` open details
  - `O` new thought below · `N` new follow-up. Once you're editing, `Enter` starts the next one, so you can write a whole list without touching the mouse.
  - `Tab` / `Shift+Tab` nest or lift out · `Alt+↑ ↓` reorder · `S` cycle status · `X` prune
  - `M` move to a limb or thought · `L` grow a vine · `Del` remove (you get an undo toast)
  - Drag rows to re-parent them. Drop on the top or bottom edge of a row to place before or after it, in the middle to nest under it, or on a limb or Seeds header to plant it there.
  - Search and filter by status, tag, limb, or wilting.
- **Tend** (`W`, or the WILTING counter): walks you through stale thoughts. Revive, park or prune each with one tap. Once a day, the app mentions any wilting thoughts when it opens.
- **Vine suggestions:** the detail panel proposes related thoughts on other limbs, based on shared tags and words. Add one as a vine or dismiss it.
- **Limbs:** drag a limb header onto another to reorder them, or use ↑↓ in Settings.
- **Canopy:** press `V`. **Replay** plays your tree growing over time, or you can scrub through it with the slider. Drag to orbit, scroll to zoom, click a light to fly to it and open it. The arrow keys still walk the tree, because selection is shared between the two views.
- **Command palette:** `Ctrl/⌘+K` for every action and for jumping to any thought.
- **Settings** (`?`): three themes (cyan holo, bioluminescent, aurora), reduced motion, particle level, when thoughts start to wilt, limb names and colours, and the keyboard reference.

## Your data

Everything is stored locally in your browser (IndexedDB), and it works offline once installed as a PWA.

- **Sync across devices (optional):** go to Settings → Sync across devices → **Turn on sync**. Then enter the sync code on your other devices. Sync is **end-to-end encrypted**: the code never leaves your devices, and the server stores only AES-GCM ciphertext under an id derived from the code. Edits merge per thought (the newest wins), deletions carry over, and sync runs a few seconds after each change, when you return to the app, and once a minute. If you lose the code, nobody can read the server copy, but each device keeps its own full local copy.
- **Export Markdown:** gives you a `.zip` with one file per limb plus `Seeds.md`. Each file is a nested list that any editor can read. Hidden comments keep ids and dates, so importing it back loses nothing.
- **Export JSON:** a full backup.
- **Import:** merges `.json`, a Mindgrove `.zip`, or plain `.md` files. Markdown you wrote by hand works too. **Restore backup** replaces everything.

## Development

Requires Node 20+ (CI uses 22).

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # Vitest: store, layout stability, export round-trip, markdown
npm run lint       # prettier --check + tsc
npm run format     # prettier --write
npm run build      # type-check + production build to dist/
npm run preview    # serve the build (no sync API)
npm run server     # serve dist/ + the sync API on :8080 (data in ./data); `npm run dev` proxies /api to it
```

Stack: Vite, React 19, TypeScript, Zustand (state), Dexie (IndexedDB), react-three-fiber, drei and @react-three/postprocessing (Canopy), vite-plugin-pwa, Vitest.

```
src/
  model/     types + pure tree helpers (outline, filters, wilting, capture parsing)
  store/     Zustand store (write-behind persistence to Dexie) + first-run demo tree
  db/        Dexie schema
  io/        Markdown + JSON export/import, tiny store-only zip
  sync/      end-to-end encrypted sync: crypto, merge (LWW + tombstones), engine
  grove/     outline view, visible-row model
  canopy/    seeded layout, holo shaders, instanced scene, projected labels
  ui/        HUD, detail panel, capture, palette, settings, hotkeys, themes
  lib/       ids/PRNG, markdown renderer, fx particles, voice, share target
server/      Node server: static files + /api/sync (compare-and-swap blobs)
```

Design notes:

- **Clean, stable layout.** Siblings fan out around their parent like seeds in a sunflower head. Each sibling's direction steps by the golden angle, the spread widens with each new sibling, and fork points are staggered along the parent, so branches don't clump or cross. A branch's slot is its rank among siblings by creation time, so adding thoughts never moves existing ones. Tests check both the spacing and the stability.
- **Fast first load.** three.js loads only when the Canopy first opens. The Grove ships at about 125 KB gzipped.
- **3D performance.** Branches and nodes are instanced meshes. The layout depends only on the tree's structure, so editing a title doesn't rebuild the scene.
- **Look.** The visual language comes from [BruNet](https://github.com/crystalcoves/BruNet): hub panels with amber corner brackets, mono labels, cyan holo lines. Following BruNet's rules, large surfaces use no `backdrop-filter` and no looping animations. Reduced motion is honoured everywhere, including the system setting on first run.

## Deploy (Fly.io)

Mindgrove runs on Fly.io like the other projects. It's the app `mindgrove` in `jnb`, and it lives at https://mindgrove.fly.dev/.

- `Dockerfile` builds the app and runs `server/server.mjs`, a small server with no dependencies. It serves `dist/` (hashed assets are immutable; the page, service worker and manifest always revalidate) and stores encrypted sync blobs in `/data`.
- `fly.toml` runs one `shared-cpu-1x` / 256 MB machine with a 1 GB volume (`mindgrove_data`). The machine stops when idle and starts again on the next request. It must stay on a single machine because the volume lives on it.
- `.github/workflows/fly-deploy.yml` runs on every push to `main`. It checks formatting, runs the tests and builds. It then creates the Fly app and volume if they don't exist yet, runs `flyctl deploy`, and smoke-tests the live site and the sync API.

One-time setup: create a deploy token with `fly tokens create org personal` (or `fly auth token`). Add it to the repository under **Settings → Secrets and variables → Actions** as `FLY_API_TOKEN`. Until the token exists, the workflow still builds and tests but skips the deploy.

Manual deploy from your machine: `fly deploy`.

`.github/workflows/ci.yml` runs the format check, the tests, and the build on pull requests.

## Roadmap

- Done since v1: growth-rings replay, wilting reminders (Tend), vine suggestions, voice capture, share target, encrypted sync
- Next ideas: sync conflict history, per-limb sharing, richer replay (vines and statuses over time)
- AI placement suggestions are intentionally deferred.

See [PLAN.md](PLAN.md) for the design brief.
