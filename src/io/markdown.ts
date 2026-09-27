import { uid } from "../lib/id";
import { byOrder, childrenIndex } from "../model/tree";
import { STATUSES, type Limb, type Link, type Snapshot, type Status, type Thought } from "../model/types";

/*
 * Markdown format — readable anywhere, and round-trips losslessly:
 *
 *   # Work
 *   <!-- mindgrove:limb {"id":"…","color":"#ffb020","order":1,"createdAt":…} -->
 *
 *   - Ship the side project `growing` #goal <!-- mg {"id":"…","c":…,"u":…,"t":…} -->
 *     > Body lines are a blockquote under their bullet.
 *     - Pick one feature for v1 `blooming` <!-- mg {…} -->
 *
 * Unplaced seeds go to `Seeds.md`. Vines (links) ride on the `from` thought's metadata.
 */

const SEEDS_MARK = "<!-- mindgrove:seeds -->";
const LIMB_RE = /^<!-- mindgrove:limb (\{.*\}) -->$/;
const META_RE = /\s*<!-- mg (\{.*\}) -->\s*$/;

interface Meta {
  id?: string;
  c?: number;
  u?: number;
  t?: number;
  title?: string;
  l?: [string, string][];
}

export interface MdFile {
  name: string;
  content: string;
}

export function exportMarkdown(s: Snapshot): MdFile[] {
  const thoughts = Object.fromEntries(s.thoughts.map((t) => [t.id, t]));
  const idx = childrenIndex(thoughts);
  const linksFrom = new Map<string, Link[]>();
  for (const l of s.links) {
    const arr = linksFrom.get(l.from) ?? [];
    arr.push(l);
    linksFrom.set(l.from, arr);
  }

  const renderBranch = (key: string, depth: number, lines: string[]) => {
    for (const t of idx.get(key) ?? []) {
      const pad = "  ".repeat(depth);
      const meta: Meta = { id: t.id, c: t.createdAt, u: t.updatedAt, t: t.touchedAt };
      const title = t.title.replace(/\s+/g, " ").trim();
      if (title !== t.title || /`|(^|\s)#|<!--|-->/.test(title)) meta.title = t.title;
      const links = linksFrom.get(t.id);
      if (links?.length) meta.l = links.map((l) => [l.id, l.to]);
      const tags = t.tags.map((x) => ` #${x}`).join("");
      lines.push(`${pad}- ${safeTitle(title)} \`${t.status}\`${tags} <!-- mg ${JSON.stringify(meta)} -->`);
      if (t.body.trim()) {
        for (const b of t.body.replace(/\s+$/, "").split("\n")) lines.push(`${pad}  >${b ? " " + b : ""}`);
      }
      renderBranch(t.id, depth + 1, lines);
    }
  };

  const files: MdFile[] = [];
  const seedLines = ["# Seeds", SEEDS_MARK, ""];
  renderBranch("seeds", 0, seedLines);
  files.push({ name: "Seeds.md", content: seedLines.join("\n") + "\n" });

  const used = new Set(["seeds"]);
  for (const limb of [...s.limbs].sort(byOrder)) {
    const lines = [
      `# ${limb.name}`,
      `<!-- mindgrove:limb ${JSON.stringify({ id: limb.id, color: limb.color, order: limb.order, createdAt: limb.createdAt, name: limb.name })} -->`,
      "",
    ];
    renderBranch(`limb:${limb.id}`, 0, lines);
    const base = fileSafe(limb.name) || "limb";
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base}-${n}`;
    used.add(name.toLowerCase());
    files.push({ name: `${name}.md`, content: lines.join("\n") + "\n" });
  }
  return files;
}

export function importMarkdown(files: MdFile[], ts = Date.now()): Snapshot {
  const thoughts: Thought[] = [];
  const limbs: Limb[] = [];
  const links: Link[] = [];

  for (const f of files) {
    const lines = f.content.replace(/\r\n?/g, "\n").split("\n");
    let limb: Limb | null = null;
    let isSeeds = false;
    let heading: string | null = null;
    const stack: Thought[] = []; // stack[d] = last thought at depth d
    const counters = new Map<string, number>();
    let last: Thought | null = null;
    let bodyLines: string[] = [];

    const flushBody = () => {
      if (last && bodyLines.length) last.body = bodyLines.join("\n").replace(/\s+$/, "");
      bodyLines = [];
    };

    for (const raw of lines) {
      const line = raw.replace(/\s+$/, "");
      if (!limb && !isSeeds && heading === null) {
        const h = /^#\s+(.*)$/.exec(line);
        if (h) {
          heading = h[1].trim();
          continue;
        }
      }
      const lm = LIMB_RE.exec(line.trim());
      if (lm) {
        const m = JSON.parse(lm[1]) as Partial<Limb>;
        limb = {
          id: m.id ?? uid(),
          name: m.name ?? heading ?? f.name.replace(/\.md$/i, ""),
          color: m.color ?? "#4fe3ff",
          order: m.order ?? limbs.length,
          createdAt: m.createdAt ?? ts,
        };
        limbs.push(limb);
        continue;
      }
      if (line.trim() === SEEDS_MARK) {
        isSeeds = true;
        continue;
      }
      const bullet = /^( *)[-*] (.*)$/.exec(line);
      if (bullet) {
        // First bullet in a hand-written file with no marker: treat the heading as a limb.
        if (!limb && !isSeeds && heading && !/^seeds$/i.test(heading)) {
          limb = { id: uid(), name: heading, color: "#4fe3ff", order: limbs.length, createdAt: ts };
          limbs.push(limb);
        } else if (!limb && !isSeeds) {
          isSeeds = true;
        }
        flushBody();
        const depth = Math.floor(bullet[1].length / 2);
        const parent = depth > 0 ? (stack[Math.min(depth, stack.length) - 1] ?? null) : null;
        const [t, outLinks] = parseBullet(bullet[2], ts);
        t.parentId = parent?.id ?? null;
        t.limbId = parent ? null : (limb?.id ?? null);
        const key = t.parentId ?? `root:${t.limbId}`;
        t.order = counters.get(key) ?? 0;
        counters.set(key, t.order + 1);
        stack.length = parent ? stack.indexOf(parent) + 1 : 0;
        stack.push(t);
        thoughts.push(t);
        last = t;
        for (const [id, to] of outLinks) links.push({ id, from: t.id, to });
        continue;
      }
      const quote = /^ *>(?: ?)(.*)$/.exec(line);
      if (quote && last) {
        bodyLines.push(quote[1]);
        continue;
      }
    }
    flushBody();
  }

  // Drop dangling links (target not in this import).
  const ids = new Set(thoughts.map((t) => t.id));
  return { thoughts, limbs, links: links.filter((l) => ids.has(l.to)) };
}

function parseBullet(text: string, ts: number): [Thought, [string, string][]] {
  let meta: Meta = {};
  const mm = META_RE.exec(text);
  if (mm) {
    try {
      meta = JSON.parse(mm[1]) as Meta;
    } catch {
      meta = {};
    }
    text = text.slice(0, mm.index);
  }
  const tags: string[] = [];
  let status: Status = "seed";
  let rest = text.trim();
  // Trailing #tags then an optional `status`.
  for (;;) {
    const tm = /\s#([\p{L}\p{N}_-]+)$/u.exec(rest);
    if (!tm) break;
    tags.unshift(tm[1]);
    rest = rest.slice(0, tm.index);
  }
  const sm = /\s?`([a-z]+)`$/.exec(rest);
  if (sm && (STATUSES as readonly string[]).includes(sm[1])) {
    status = sm[1] as Status;
    rest = rest.slice(0, sm.index);
  }
  const title = meta.title ?? unsafeTitle(rest.trim());
  const thought: Thought = {
    id: meta.id ?? uid(),
    parentId: null,
    limbId: null,
    title,
    body: "",
    status,
    tags,
    order: 0,
    createdAt: meta.c ?? ts,
    updatedAt: meta.u ?? ts,
    touchedAt: meta.t ?? ts,
  };
  return [thought, Array.isArray(meta.l) ? meta.l : []];
}

function safeTitle(t: string) {
  return t || "(untitled)";
}
function unsafeTitle(t: string) {
  return t === "(untitled)" ? "" : t;
}

function fileSafe(name: string) {
  return name
    .replace(/[\\/:*?"<>|#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}
