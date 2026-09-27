import type { Limb, Link, Snapshot, Status, Thought } from "../model/types";

type Node = [title: string, status: Status, kids?: Node[], extra?: { body?: string; tags?: string[]; age?: number }];

/**
 * A small starter tree so a first visit has something alive to explore.
 * Fixed ids, so two devices that both start from the demo merge it into one when synced.
 */
export function demoSnapshot(ts: number): Snapshot {
  const limbs: Limb[] = [];
  const thoughts: Thought[] = [];
  const links: Link[] = [];
  const byTitle: Record<string, string> = {};

  const addLimb = (name: string, color: string) => {
    const l: Limb = { id: `demo-limb-${limbs.length}`, name, color, order: limbs.length, createdAt: ts - 30 * 86400e3 };
    limbs.push(l);
    return l.id;
  };

  const grow = (nodes: Node[], parentId: string | null, limbId: string | null) => {
    nodes.forEach(([title, status, kids, extra], order) => {
      const age = (extra?.age ?? 2) * 86400e3;
      const t: Thought = {
        id: `demo-${thoughts.length}`,
        parentId,
        limbId: parentId ? null : limbId,
        title,
        body: extra?.body ?? "",
        status,
        tags: extra?.tags ?? [],
        order,
        createdAt: ts - age - 86400e3,
        updatedAt: ts - age,
        touchedAt: ts - age,
      };
      thoughts.push(t);
      byTitle[title] = t.id;
      if (kids) grow(kids, t.id, null);
    });
  };

  grow(
    [
      [
        "Press / to drop a seed",
        "seed",
        undefined,
        {
          body: "Type a thought and hit **Enter**. Add `#tags` inline.\n\nSeeds wait here in the inbox until you place them on a limb.",
          age: 0,
        },
      ],
      ["Drag a seed onto a limb to plant it", "seed", undefined, { age: 0 }],
    ],
    null,
    null,
  );

  grow(
    [
      [
        "How Mindgrove works",
        "growing",
        [
          ["Grove is the fast outline — V switches to the 3D Canopy", "blooming", undefined, { tags: ["tips"] }],
          [
            "Keyboard first",
            "growing",
            [
              ["↑ ↓ move · ← → fold · Enter edits", "blooming", undefined, { tags: ["tips"] }],
              ["Tab nests a thought under the one above · Shift+Tab lifts it", "blooming", undefined, { tags: ["tips"] }],
              ["Ctrl+K opens the command palette", "blooming", undefined, { tags: ["tips"] }],
            ],
          ],
          [
            "Status: seed → growing → blooming → dormant → pruned",
            "growing",
            undefined,
            {
              body: "Press **S** on a row to cycle status.\n\n- *Blooming* = it became an action, or it's done.\n- *Dormant* = parked on purpose.\n- *Pruned* = let go, kept for history.",
            },
          ],
          [
            "Untouched thoughts wilt after a few weeks",
            "growing",
            undefined,
            { age: 40, body: "Wilting thoughts fade in the canopy. Open one to revive it — or prune it." },
          ],
        ],
        { body: "Trunk = you. Limbs = themes. Branches = thoughts. Twigs = follow-ups." },
      ],
    ],
    null,
    addLimb("Getting started", "#4fe3ff"),
  );

  grow(
    [
      [
        "Ship the side project",
        "growing",
        [
          ["Pick one feature for v1", "blooming"],
          ["Write the landing page copy", "growing", [["Lead with the problem, not the tech", "seed"]]],
          ["Ask three friends to try it", "seed", undefined, { tags: ["people"] }],
        ],
        { tags: ["goal"] },
      ],
      ["Weekly review ritual", "dormant", [["Friday 4pm, 20 minutes", "dormant"]]],
    ],
    null,
    addLimb("Work", "#ffb020"),
  );

  grow(
    [
      [
        "Learn to cook five dinners by heart",
        "growing",
        [
          ["Shakshuka", "blooming"],
          ["Dal", "growing"],
          ["Risotto", "seed"],
        ],
      ],
      ["Walk more", "seed", undefined, { age: 35 }],
    ],
    null,
    addLimb("Life", "#5dffa8"),
  );

  grow(
    [
      ["A garden that grows from your notes", "growing", [["Vines connect ideas across limbs", "seed"]], { tags: ["meta"] }],
      ["Tiny tools beat big systems", "seed"],
    ],
    null,
    addLimb("Ideas", "#b07bff"),
  );

  const link = (a: string, b: string) => {
    if (byTitle[a] && byTitle[b]) links.push({ id: `demo-vine-${links.length}`, from: byTitle[a], to: byTitle[b] });
  };
  link("Tiny tools beat big systems", "Pick one feature for v1");
  link("A garden that grows from your notes", "How Mindgrove works");
  link("Walk more", "Weekly review ritual");

  return { thoughts, limbs, links };
}
