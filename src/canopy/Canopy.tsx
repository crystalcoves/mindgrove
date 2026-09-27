import { Canvas } from "@react-three/fiber";
import { Component, useMemo, useState, type ReactNode } from "react";
import { useStore } from "../store/store";
import { STATUS_META } from "../model/types";
import { STATUS_COLORS, THEMES } from "../ui/themes";
import { LabelLayer } from "./labels";
import { Scene, type CanopyOptions } from "./Scene";

export default function Canopy() {
  const [opts, setOpts] = useState<CanopyOptions>({ autoRotate: true, labels: true, recenter: 0 });
  const theme = useStore((s) => s.settings.theme);
  const reduced = useStore((s) => s.settings.reducedMotion);
  const thoughts = useStore((s) => s.thoughts);
  const limbs = useStore((s) => s.limbs);
  const links = useStore((s) => s.links);
  const st = useStore.getState;

  const counts = useMemo(() => {
    const living = Object.values(thoughts).filter((t) => t.status !== "pruned").length;
    return { living, limbs: Object.keys(limbs).length, vines: Object.keys(links).length };
  }, [thoughts, limbs, links]);

  return (
    <div className={`canopy${reduced ? "" : " reveal"}`}>
      <GLBoundary>
        <Canvas
          dpr={[1, 1.75]}
          camera={{ position: [10, 9, 16], fov: 45, near: 0.1, far: 200 }}
          gl={{ antialias: true, powerPreference: "high-performance" }}
          style={{ background: THEMES[theme].scene.bg }}
          aria-label="3D thought tree"
        >
          <Scene opts={opts} />
        </Canvas>
        <LabelLayer />
      </GLBoundary>

      <div className="c-hud">
        <div className="kan">樹 冠</div>
        <h2>Canopy</h2>
        <p>
          {counts.living} thoughts · {counts.limbs} limbs · {counts.vines} vines
          <br />
          drag to orbit · scroll to zoom · click a light to focus · ↑↓ walk the tree
        </p>
      </div>

      <div className="c-legend" aria-hidden>
        {(["seed", "growing", "blooming", "dormant"] as const).map((s) => (
          <span key={s} style={{ "--sc": STATUS_COLORS[s] } as React.CSSProperties}>
            <i />
            {STATUS_META[s].label.toUpperCase()}
          </span>
        ))}
        <span style={{ "--sc": "#8a8a8a" } as React.CSSProperties}>
          <i />
          WILTING
        </span>
      </div>

      <nav className="c-dock" aria-label="Canopy controls">
        <button onClick={() => setOpts((o) => ({ ...o, recenter: o.recenter + 1 }))} title="Recenter the view">
          <b>⌖</b>
          <span>RECENTER</span>
        </button>
        <button
          className={opts.autoRotate && !reduced ? "on" : ""}
          onClick={() => setOpts((o) => ({ ...o, autoRotate: !o.autoRotate }))}
          title={reduced ? "Off while reduced motion is on" : "Slowly orbit"}
          disabled={reduced}
        >
          <b>↻</b>
          <span>DRIFT</span>
        </button>
        <button
          className={opts.labels ? "on" : ""}
          onClick={() => setOpts((o) => ({ ...o, labels: !o.labels }))}
          title="Show limb and branch names"
        >
          <b>Aa</b>
          <span>LABELS</span>
        </button>
        <button onClick={() => st().openCapture(true)} title="Capture (/)">
          <b>✦</b>
          <span>CAPTURE</span>
        </button>
        <button onClick={() => st().setView("grove")} title="Back to the outline (V)">
          <b>☰</b>
          <span>GROVE</span>
        </button>
      </nav>
    </div>
  );
}

class GLBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <div className="c-fallback">
          <div>
            <div className="label amber">3D unavailable</div>
            <p>This device couldn't start WebGL. Everything lives in the Grove too.</p>
            <button className="btn" onClick={() => useStore.getState().setView("grove")}>
              ☰ Open the Grove
            </button>
          </div>
        </div>
      );
    return this.props.children;
  }
}
