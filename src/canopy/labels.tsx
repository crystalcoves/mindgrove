import { useFrame, useThree } from "@react-three/fiber";
import { useEffect } from "react";
import * as THREE from "three";
import { create } from "zustand";
import type { V3 } from "./layout";

/*
 * Screen-space labels for the canopy. The Scene publishes label specs; a plain
 * DOM layer renders them; a frame hook projects each 3D anchor to the screen
 * and hides lower-priority labels that would overlap higher ones.
 */

export interface LabelSpec {
  key: string;
  pos: V3;
  kind: "limb" | "twig" | "node" | "seeds";
  text: string;
  sub?: string;
  color: string;
  /** Higher wins overlaps. */
  priority: number;
  selected?: boolean;
}

const useLabels = create<{ specs: LabelSpec[] }>(() => ({ specs: [] }));
const elements = new Map<string, HTMLDivElement>();

export function usePublishLabels(specs: LabelSpec[]) {
  useEffect(() => {
    useLabels.setState({ specs });
  }, [specs]);
  useEffect(() => () => useLabels.setState({ specs: [] }), []);
}

const v = new THREE.Vector3();

/** Lives inside the Canvas. */
export function LabelProjector() {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  useFrame(() => {
    const specs = [...useLabels.getState().specs].sort((a, b) => b.priority - a.priority);
    const placed: [number, number, number, number][] = [];
    // Keep branch labels out from under the HUD title block.
    const layer = document.querySelector(".c-labels")?.getBoundingClientRect();
    const hud = document.querySelector(".c-hud")?.getBoundingClientRect();
    const blocked: [number, number, number, number] | null =
      layer && hud ? [hud.left - layer.left, hud.top - layer.top, hud.right - layer.left, hud.bottom - layer.top] : null;
    for (const s of specs) {
      const el = elements.get(s.key);
      if (!el) continue;
      v.set(s.pos[0], s.pos[1], s.pos[2]).project(camera);
      if (v.z > 1 || v.z < -1) {
        el.style.opacity = "0";
        continue;
      }
      const x = (v.x * 0.5 + 0.5) * size.width;
      const y = (-v.y * 0.5 + 0.5) * size.height;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      // Pad the box so neighbouring labels keep a little breathing room.
      const rect: [number, number, number, number] = [x - w / 2 - 6, y - h - 14, x + w / 2 + 6, y - 6];
      const hit = (p: [number, number, number, number]) => rect[0] < p[2] && rect[2] > p[0] && rect[1] < p[3] && rect[3] > p[1];
      const clash = s.priority < 9 && ((s.priority < 3 && placed.some(hit)) || (!!blocked && hit(blocked)));
      el.style.transform = `translate3d(${Math.round(x - w / 2)}px, ${Math.round(y - h - 10)}px, 0)`;
      el.style.opacity = clash ? "0" : "1";
      if (!clash) placed.push(rect);
    }
  });
  return null;
}

/** Lives outside the Canvas, over it. */
export function LabelLayer() {
  const specs = useLabels((s) => s.specs);
  return (
    <div className="c-labels" aria-hidden>
      {specs.map((s) => (
        <div
          key={s.key}
          ref={(el) => {
            if (el) elements.set(s.key, el);
            else elements.delete(s.key);
          }}
          className={`lbl lbl-${s.kind}${s.selected ? " sel" : ""}`}
          style={{ "--c": s.color, opacity: 0 } as React.CSSProperties}
        >
          {s.sub && <small>{s.sub}</small>}
          {s.text}
        </div>
      ))}
    </div>
  );
}
