import { Line, OrbitControls } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { hash32, rng } from "../lib/id";
import { ancestors, wiltAmount } from "../model/tree";
import type { Thought } from "../model/types";
import { useStore } from "../store/store";
import { THEMES } from "../ui/themes";
import { add, layoutTree, scale, TRUNK_HEIGHT, type Layout, type Segment, type V3 } from "./layout";
import { LabelProjector, usePublishLabels, type LabelSpec } from "./labels";
import { branchFragment, branchVertex, groundFragment, groundVertex, sporeFragment, sporeVertex } from "./shaders";

const UP = new THREE.Vector3(0, 1, 0);
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const tmpC = new THREE.Color();

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeBack = (t: number) => {
  const c1 = 1.70158,
    c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

export interface CanopyOptions {
  autoRotate: boolean;
  labels: boolean;
  recenter: number;
}

// ---- data → drawable ------------------------------------------------------

interface BranchEntry {
  id: string;
  seg: Segment;
  color: THREE.Color;
  fade: number;
  delay: number;
}

interface NodeEntry {
  id: string;
  pos: V3;
  color: THREE.Color;
  size: number;
  delay: number;
  seed: boolean;
  phase: number;
}

/** Layout only depends on structure, so typing in a title doesn't re-grow the tree. */
function useLayout(): Layout {
  const thoughts = useStore((s) => s.thoughts);
  const limbs = useStore((s) => s.limbs);
  const sig = useMemo(() => {
    let s = "";
    for (const t of Object.values(thoughts)) s += `${t.id}:${t.parentId ?? ""}:${t.limbId ?? ""};`;
    for (const l of Object.values(limbs)) s += `L${l.id}:${l.order};`;
    return s;
  }, [thoughts, limbs]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => layoutTree(useStore.getState().thoughts, Object.values(useStore.getState().limbs)), [sig]);
}

/** Thoughts drawn in the canopy: not pruned, and no pruned ancestor. */
function useVisible(): Thought[] {
  const thoughts = useStore((s) => s.thoughts);
  return useMemo(() => {
    const hidden = new Map<string, boolean>();
    const isHidden = (t: Thought): boolean => {
      const hit = hidden.get(t.id);
      if (hit !== undefined) return hit;
      hidden.set(t.id, true); // cycle guard
      const p = t.parentId ? thoughts[t.parentId] : undefined;
      const h = t.status === "pruned" || (!!p && isHidden(p));
      hidden.set(t.id, h);
      return h;
    };
    return Object.values(thoughts).filter((t) => !isHidden(t));
  }, [thoughts]);
}

function colorFor(t: Thought, limbColor: string, bloom: string): THREE.Color {
  const c = new THREE.Color(limbColor);
  switch (t.status) {
    case "blooming":
      return new THREE.Color(bloom).multiplyScalar(2.6);
    case "dormant":
      return c.lerp(new THREE.Color("#6f86ff"), 0.6).multiplyScalar(0.8);
    case "seed":
      return c.lerp(new THREE.Color("#ffffff"), 0.45).multiplyScalar(1.6);
    default:
      return c.multiplyScalar(2.1);
  }
}

// ---- scene ---------------------------------------------------------------

export function Scene({ opts }: { opts: CanopyOptions }) {
  const layout = useLayout();
  const visible = useVisible();
  const thoughts = useStore((s) => s.thoughts);
  const limbs = useStore((s) => s.limbs);
  const links = useStore((s) => s.links);
  const settings = useStore((s) => s.settings);
  const theme = THEMES[settings.theme].scene;
  const motion = settings.reducedMotion ? 0 : 1;
  const mountAt = useMemo(() => performance.now(), []);
  const [hovered, setHovered] = useState<string | null>(null);

  const limbColorOf = useMemo(() => {
    const cache = new Map<string, string>();
    return (t: Thought) => {
      const hit = cache.get(t.id);
      if (hit) return hit;
      const root = ancestors(thoughts, t.id)[0] ?? t;
      const c = (root.limbId && limbs[root.limbId]?.color) || "#cfe3ee";
      cache.set(t.id, c);
      return c;
    };
  }, [thoughts, limbs]);

  const { branches, nodes, maxDelay } = useMemo(() => {
    const now = Date.now();
    const trunkColor = new THREE.Color(theme.trunk).multiplyScalar(0.75);
    const branches: BranchEntry[] = [{ id: "trunk", seg: layout.trunk, color: trunkColor, fade: 0, delay: 0 }];
    // Roots: decorative, seeded so they never change.
    const r = rng("roots");
    for (let i = 0; i < 6; i++) {
      const az = (i / 6) * Math.PI * 2 + r() * 0.5;
      const dir: V3 = [Math.cos(az), -0.28 - r() * 0.2, Math.sin(az)];
      const len = 1.6 + r() * 1.4;
      const l = Math.hypot(...dir);
      const d: V3 = [dir[0] / l, dir[1] / l, dir[2] / l];
      const start: V3 = [0, 0.35, 0];
      branches.push({
        id: `root${i}`,
        seg: { start, end: add(start, scale(d, len)), dir: d, radius: 0.14, depth: -1, limbId: null },
        color: trunkColor.clone().multiplyScalar(0.55),
        fade: 0,
        delay: 0.05,
      });
    }
    for (const l of Object.values(limbs)) {
      const seg = layout.limbs.get(l.id);
      if (seg)
        branches.push({
          id: `limb:${l.id}`,
          seg,
          color: new THREE.Color(l.color).multiplyScalar(0.95),
          fade: 0,
          delay: 0.35 + (l.order % 8) * 0.06,
        });
    }
    const nodes: NodeEntry[] = [];
    let maxDelay = 1;
    for (const t of visible) {
      const seg = layout.nodes.get(t.id);
      if (!seg) continue;
      const seed = seg.start === seg.end;
      const depth = seg.depth;
      const delay = seed ? 0.2 + (hash32(t.id) % 100) / 200 : 0.7 + depth * 0.3 + (hash32(t.id) % 100) / 600;
      maxDelay = Math.max(maxDelay, delay);
      const lc = limbColorOf(t);
      const fade = wiltAmount(t, now, settings.wiltWeeks);
      const c = colorFor(t, lc, theme.bloom);
      if (fade) {
        const grey = (c.r + c.g + c.b) / 3;
        c.lerp(new THREE.Color(grey, grey, grey), fade).multiplyScalar(1 - 0.6 * fade);
      }
      if (!seed) {
        const bc = new THREE.Color(lc).multiplyScalar(t.status === "dormant" ? 0.45 : 0.85);
        branches.push({ id: t.id, seg, color: bc, fade, delay });
      }
      const size = seed
        ? 0.08
        : { seed: 0.07, growing: 0.085, blooming: 0.15, dormant: 0.065, pruned: 0 }[t.status] * Math.max(0.55, Math.pow(0.9, depth)) + 0.02;
      nodes.push({ id: t.id, pos: seg.end, color: c, size, delay: delay + 0.6, seed, phase: (hash32(t.id) % 1000) / 159 });
    }
    return { branches, nodes, maxDelay: maxDelay + 1.6 };
  }, [layout, visible, limbs, theme, settings.wiltWeeks, limbColorOf]);

  const growth = (id: string, delay: number, now: number) => {
    if (!motion) return 1;
    let g = clamp01(((now - mountAt) / 1000 - delay) / 0.9);
    const born = useStore.getState().births[id];
    if (born) g = Math.min(g, clamp01((now - born) / 1100));
    return g;
  };

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const selectedId = useStore((s) => s.selectedId);
  const selected = selectedId ? nodeById.get(selectedId) : undefined;
  const hoveredNode = hovered ? nodeById.get(hovered) : undefined;

  return (
    <>
      <color attach="background" args={[theme.bg]} />
      <fog attach="fog" args={[theme.fog, 22, 60]} />
      <Ground color={theme.grid} motion={motion} />
      <Branches entries={branches} growth={growth} motion={motion} maxDelay={maxDelay} mountAt={mountAt} />
      <Nodes
        entries={nodes}
        growth={growth}
        motion={motion}
        maxDelay={maxDelay}
        mountAt={mountAt}
        selectedId={selectedId}
        hoveredId={hovered}
        onHover={setHovered}
      />
      <Vines links={Object.values(links)} nodes={nodeById} color={theme.vine} motion={motion} selectedId={selectedId} />
      <Spores color={theme.particle} motion={motion} level={settings.particles} />
      {selected && <SelectionRing pos={selected.pos} size={selected.size} color={theme.bloom} motion={motion} />}
      <Labels opts={opts} layout={layout} nodes={nodes} hovered={hoveredNode} selected={selected} limbColorOf={limbColorOf} />
      <CameraRig
        focus={selected?.pos ?? null}
        autoRotate={opts.autoRotate && !!motion}
        recenter={opts.recenter}
        layout={layout}
        motion={motion}
      />
      <EffectComposer multisampling={0}>
        <Bloom mipmapBlur intensity={theme.bloomIntensity} luminanceThreshold={0.32} luminanceSmoothing={0.3} radius={0.72} />
        <Vignette offset={0.22} darkness={0.85} />
      </EffectComposer>
    </>
  );
}

// ---- branches (instanced holo cylinders) -----------------------------------

type GrowthFn = (id: string, delay: number, now: number) => number;

function useCapacity(n: number) {
  const [cap, setCap] = useState(() => Math.max(256, Math.ceil(n * 1.5)));
  useEffect(() => {
    if (n > cap) setCap(Math.ceil(n * 1.5));
  }, [n, cap]);
  return Math.max(cap, n);
}

function Branches({
  entries,
  growth,
  motion,
  maxDelay,
  mountAt,
}: {
  entries: BranchEntry[];
  growth: GrowthFn;
  motion: number;
  maxDelay: number;
  mountAt: number;
}) {
  const cap = useCapacity(entries.length);
  const mesh = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => {
    const g = new THREE.CylinderGeometry(0.6, 1, 1, 10, 1, true);
    g.translate(0, 0.5, 0);
    g.setAttribute("aColor", new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3));
    g.setAttribute("aFade", new THREE.InstancedBufferAttribute(new Float32Array(cap), 1));
    return g;
  }, [cap]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: branchVertex,
        fragmentShader: branchFragment,
        uniforms: { uTime: { value: 0 }, uMotion: { value: 1 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    [],
  );
  const dirty = useRef(true);

  useLayoutEffect(() => {
    const colors = geometry.getAttribute("aColor") as THREE.InstancedBufferAttribute;
    const fades = geometry.getAttribute("aFade") as THREE.InstancedBufferAttribute;
    entries.forEach((e, i) => {
      colors.setXYZ(i, e.color.r, e.color.g, e.color.b);
      fades.setX(i, e.fade);
    });
    colors.needsUpdate = true;
    fades.needsUpdate = true;
    dirty.current = true;
  }, [entries, geometry]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  const lastBirth = useStore((s) => Math.max(0, ...entries.map((e) => s.births[e.id] ?? 0)));

  useFrame(({ clock }) => {
    material.uniforms.uTime.value = clock.elapsedTime;
    material.uniforms.uMotion.value = motion;
    const m = mesh.current;
    if (!m) return;
    const now = performance.now();
    const animating = motion && ((now - mountAt) / 1000 < maxDelay || now - lastBirth < 1300);
    if (!animating && !dirty.current) return;
    dirty.current = false;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const g = easeOut(growth(e.id, e.delay, now));
      const len = Math.hypot(e.seg.end[0] - e.seg.start[0], e.seg.end[1] - e.seg.start[1], e.seg.end[2] - e.seg.start[2]);
      tmpQ.setFromUnitVectors(UP, tmpV.set(e.seg.dir[0], e.seg.dir[1], e.seg.dir[2]));
      const r = e.seg.radius * (0.3 + 0.7 * g);
      tmpS.set(r, Math.max(1e-4, len * g), r);
      tmpM.compose(tmpV.set(e.seg.start[0], e.seg.start[1], e.seg.start[2]), tmpQ, tmpS);
      m.setMatrixAt(i, tmpM);
    }
    m.count = entries.length;
    m.instanceMatrix.needsUpdate = true;
    if (animating) dirty.current = true; // one more pass to settle at g = 1
  });

  return <instancedMesh ref={mesh} args={[geometry, material, cap]} frustumCulled={false} raycast={() => null} />;
}

// ---- nodes (glowing buds, seeds and blossoms) ---------------------------------

interface NodesProps {
  entries: NodeEntry[];
  growth: GrowthFn;
  motion: number;
  maxDelay: number;
  mountAt: number;
  selectedId: string | null;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
}

function Nodes({ entries, growth, motion, maxDelay, mountAt, selectedId, hoveredId, onHover }: NodesProps) {
  const cap = useCapacity(entries.length);
  const mesh = useRef<THREE.InstancedMesh>(null);
  const pick = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => new THREE.IcosahedronGeometry(1, 2), []);
  const material = useMemo(
    () => new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    [],
  );
  const pickMaterial = useMemo(() => new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }), []);
  const dirty = useRef(true);
  const hasSeeds = entries.some((e) => e.seed);
  const lastBirth = useStore((s) => Math.max(0, ...entries.map((e) => s.births[e.id] ?? 0)));

  useLayoutEffect(() => {
    const m = mesh.current;
    const p = pick.current;
    if (!m || !p) return;
    entries.forEach((e, i) => {
      m.setColorAt(i, e.id === selectedId ? tmpC.set("#ffffff").multiplyScalar(3) : e.color);
      tmpM.compose(tmpV.set(...e.pos), tmpQ.identity(), tmpS.setScalar(Math.max(0.28, e.size * 2.6)));
      p.setMatrixAt(i, tmpM);
    });
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    p.count = entries.length;
    p.instanceMatrix.needsUpdate = true;
    p.computeBoundingSphere();
    dirty.current = true;
  }, [entries, selectedId, cap]);

  useEffect(() => {
    dirty.current = true;
  }, [hoveredId]);

  useFrame(({ clock }) => {
    const m = mesh.current;
    if (!m) return;
    const now = performance.now();
    const animating = motion && ((now - mountAt) / 1000 < maxDelay || now - lastBirth < 1600 || hasSeeds || selectedId);
    if (!animating && !dirty.current) return;
    dirty.current = false;
    const t = clock.elapsedTime;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const g = clamp01(growth(e.id, e.delay, now));
      let s = e.size * (g < 1 ? Math.max(0, easeBack(g)) : 1);
      if (e.id === selectedId) s *= 1.7 + 0.15 * Math.sin(t * 4) * motion;
      else if (e.id === hoveredId) s *= 1.4;
      const bob = e.seed ? Math.sin(t * 1.3 + e.phase) * 0.12 * motion : 0;
      tmpM.compose(tmpV.set(e.pos[0], e.pos[1] + bob, e.pos[2]), tmpQ.identity(), tmpS.setScalar(Math.max(1e-4, s)));
      m.setMatrixAt(i, tmpM);
    }
    m.count = entries.length;
    m.instanceMatrix.needsUpdate = true;
  });

  const idAt = (e: ThreeEvent<PointerEvent | MouseEvent>) => (e.instanceId != null ? entries[e.instanceId]?.id : undefined);

  return (
    <>
      <instancedMesh ref={mesh} args={[geometry, material, cap]} frustumCulled={false} raycast={() => null} />
      <instancedMesh
        ref={pick}
        args={[geometry, pickMaterial, cap]}
        onPointerMove={(e) => {
          e.stopPropagation();
          const id = idAt(e);
          if (id && id !== hoveredId) onHover(id);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          onHover(null);
          document.body.style.cursor = "";
        }}
        onClick={(e) => {
          e.stopPropagation();
          const id = idAt(e);
          if (id) useStore.getState().select(id, { open: true });
        }}
      />
    </>
  );
}

// ---- vines -------------------------------------------------------------------

function Vines({
  links,
  nodes,
  color,
  motion,
  selectedId,
}: {
  links: { id: string; from: string; to: string }[];
  nodes: Map<string, NodeEntry>;
  color: string;
  motion: number;
  selectedId: string | null;
}) {
  const curves = useMemo(
    () =>
      links.flatMap((l) => {
        const a = nodes.get(l.from);
        const b = nodes.get(l.to);
        if (!a || !b) return [];
        const va = new THREE.Vector3(...a.pos);
        const vb = new THREE.Vector3(...b.pos);
        const mid = va.clone().add(vb).multiplyScalar(0.5);
        mid.y += 1.2 + va.distanceTo(vb) * 0.25;
        const pts = new THREE.QuadraticBezierCurve3(va, mid, vb).getPoints(32);
        return [{ id: l.id, pts, hot: l.from === selectedId || l.to === selectedId }];
      }),
    [links, nodes, selectedId],
  );
  return (
    <>
      {curves.map((c) => (
        <Vine key={c.id} pts={c.pts} color={color} hot={c.hot} motion={motion} />
      ))}
    </>
  );
}

function Vine({ pts, color, hot, motion }: { pts: THREE.Vector3[]; color: string; hot: boolean; motion: number }) {
  const ref = useRef<{ material: { dashOffset: number } } | null>(null);
  const c = useMemo(() => new THREE.Color(color).multiplyScalar(hot ? 3 : 1.6), [color, hot]);
  useFrame((_, dt) => {
    if (ref.current && motion) ref.current.material.dashOffset -= dt * 0.5;
  });
  return (
    <Line
      ref={ref as never}
      points={pts}
      color={c}
      lineWidth={hot ? 2.4 : 1.4}
      dashed
      dashSize={0.35}
      gapSize={0.18}
      transparent
      opacity={hot ? 1 : 0.7}
      toneMapped={false}
      depthWrite={false}
    />
  );
}

// ---- ambience ---------------------------------------------------------------

function Spores({ color, motion, level }: { color: string; motion: number; level: "high" | "low" | "off" }) {
  const count = level === "off" ? 0 : level === "low" ? 220 : 600;
  const height = 16;
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    const r = rng("spores");
    for (let i = 0; i < count; i++) {
      const a = r() * Math.PI * 2;
      const rad = 1 + Math.sqrt(r()) * 13;
      pos.set([Math.cos(a) * rad, r() * height, Math.sin(a) * rad], i * 3);
      seed[i] = r();
    }
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    return g;
  }, [count]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: sporeVertex,
        fragmentShader: sporeFragment,
        uniforms: {
          uTime: { value: 0 },
          uMotion: { value: 1 },
          uSize: { value: 1 },
          uHeight: { value: height },
          uColor: { value: new THREE.Color() },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  const dpr = useThree((s) => s.viewport.dpr);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useFrame(({ clock }) => {
    material.uniforms.uTime.value = clock.elapsedTime;
    material.uniforms.uMotion.value = motion;
    material.uniforms.uSize.value = 2.6 * dpr;
    (material.uniforms.uColor.value as THREE.Color).set(color);
  });
  if (!count) return null;
  return <points geometry={geometry} material={material} frustumCulled={false} />;
}

function Ground({ color, motion }: { color: string; motion: number }) {
  const radius = 16;
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: groundVertex,
        fragmentShader: groundFragment,
        uniforms: { uTime: { value: 0 }, uMotion: { value: 1 }, uRadius: { value: radius }, uColor: { value: new THREE.Color() } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  useFrame(({ clock }) => {
    material.uniforms.uTime.value = clock.elapsedTime;
    material.uniforms.uMotion.value = motion;
    (material.uniforms.uColor.value as THREE.Color).set(color).multiplyScalar(0.9);
  });
  return (
    <mesh rotation-x={-Math.PI / 2} material={material} raycast={() => null}>
      <circleGeometry args={[radius, 96]} />
    </mesh>
  );
}

function SelectionRing({ pos, size, color, motion }: { pos: V3; size: number; color: string; motion: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const camera = useThree((s) => s.camera);
  const c = useMemo(() => new THREE.Color(color).multiplyScalar(2.5), [color]);
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    m.quaternion.copy(camera.quaternion);
    const k = motion ? 1 + 0.25 * ((clock.elapsedTime * 1.2) % 1) : 1.1;
    m.scale.setScalar(Math.max(0.35, size * 4) * k);
    (m.material as THREE.MeshBasicMaterial).opacity = motion ? 1 - ((clock.elapsedTime * 1.2) % 1) * 0.8 : 0.8;
  });
  return (
    <mesh ref={ref} position={pos} raycast={() => null}>
      <ringGeometry args={[0.82, 1, 48]} />
      <meshBasicMaterial color={c} toneMapped={false} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
    </mesh>
  );
}

// ---- labels --------------------------------------------------------------------

function Labels({
  opts,
  layout,
  nodes,
  hovered,
  selected,
  limbColorOf,
}: {
  opts: CanopyOptions;
  layout: Layout;
  nodes: NodeEntry[];
  hovered?: NodeEntry;
  selected?: NodeEntry;
  limbColorOf: (t: Thought) => string;
}) {
  const limbs = useStore((s) => s.limbs);
  const thoughts = useStore((s) => s.thoughts);

  const specs = useMemo(() => {
    const out: LabelSpec[] = [];
    const nodeSpec = (n: NodeEntry, sel: boolean): LabelSpec | null => {
      const t = thoughts[n.id];
      if (!t) return null;
      const root = ancestors(thoughts, t.id)[0] ?? t;
      const limb = root.limbId ? limbs[root.limbId]?.name : "Seed";
      return {
        key: `${sel ? "s" : "h"}:${n.id}`,
        pos: n.pos,
        kind: "node",
        text: t.title || "untitled",
        sub: `${limb} · ${t.status}`,
        color: limbColorOf(t),
        priority: sel ? 10 : 9,
        selected: sel,
      };
    };
    if (selected) {
      const s = nodeSpec(selected, true);
      if (s) out.push(s);
    }
    if (hovered && hovered.id !== selected?.id) {
      const h = nodeSpec(hovered, false);
      if (h) out.push(h);
    }
    if (opts.labels) {
      for (const l of Object.values(limbs)) {
        const seg = layout.limbs.get(l.id);
        if (seg) out.push({ key: `l:${l.id}`, pos: add(seg.end, [0, 0.35, 0]), kind: "limb", text: l.name, color: l.color, priority: 5 });
      }
      let seeds = 0;
      for (const n of nodes) {
        if (n.seed) {
          seeds++;
          continue;
        }
        if (n.id === selected?.id || n.id === hovered?.id || layout.nodes.get(n.id)?.depth !== 0) continue;
        const t = thoughts[n.id];
        if (t) out.push({ key: `t:${n.id}`, pos: n.pos, kind: "twig", text: t.title, color: limbColorOf(t), priority: 1 });
      }
      if (seeds)
        out.push({
          key: "seeds",
          pos: [0, 0.05, 4.6],
          kind: "seeds",
          text: `◦ ${seeds} seed${seeds > 1 ? "s" : ""} on the ground`,
          color: "#9fb4c2",
          priority: 2,
        });
    }
    return out;
  }, [opts.labels, layout, nodes, hovered, selected, limbs, thoughts, limbColorOf]);

  usePublishLabels(specs);
  return <LabelProjector />;
}

// ---- camera ---------------------------------------------------------------------

function CameraRig({
  focus,
  autoRotate,
  recenter,
  layout,
  motion,
}: {
  focus: V3 | null;
  autoRotate: boolean;
  recenter: number;
  layout: Layout;
  motion: number;
}) {
  const controls = useRef<OrbitControlsImpl>(null);
  const camera = useThree((s) => s.camera);
  const flight = useRef<{ fromT: THREE.Vector3; toT: THREE.Vector3; fromP: THREE.Vector3; toP: THREE.Vector3; t: number } | null>(null);

  const home = useMemo(() => {
    let r = 8;
    for (const s of layout.nodes.values()) r = Math.max(r, Math.hypot(s.end[0], s.end[2]), s.end[1] * 0.8);
    for (const s of layout.limbs.values()) r = Math.max(r, Math.hypot(s.end[0], s.end[2]));
    const d = Math.min(38, 9 + r * 1.35);
    return {
      target: new THREE.Vector3(0, TRUNK_HEIGHT * 0.8, 0),
      pos: new THREE.Vector3(d * 0.55, TRUNK_HEIGHT * 0.8 + d * 0.28, d * 0.85),
    };
  }, [layout]);

  const fly = (toT: THREE.Vector3, toP: THREE.Vector3) => {
    const c = controls.current;
    if (!c) return;
    if (!motion) {
      c.target.copy(toT);
      camera.position.copy(toP);
      c.update();
      return;
    }
    flight.current = { fromT: c.target.clone(), toT, fromP: camera.position.clone(), toP, t: 0 };
  };

  // First frame: start at home.
  useEffect(() => {
    camera.position.copy(home.pos);
    controls.current?.target.copy(home.target);
    controls.current?.update();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (recenter) fly(home.target.clone(), home.pos.clone());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenter]);

  const focusKey = focus ? focus.join(",") : "";
  useEffect(() => {
    if (!focus || !controls.current) return;
    const toT = new THREE.Vector3(...focus);
    // Keep the current viewing direction, come in to a comfortable distance.
    const dir = camera.position.clone().sub(controls.current.target).normalize();
    const dist = Math.min(9, Math.max(5, camera.position.distanceTo(controls.current.target) * 0.6));
    const toP = toT.clone().add(dir.multiplyScalar(dist));
    toP.y = Math.max(toP.y, 0.8);
    fly(toT, toP);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);

  useFrame((_, dt) => {
    const f = flight.current;
    const c = controls.current;
    if (!f || !c) return;
    f.t = Math.min(1, f.t + dt / 0.9);
    const k = 1 - Math.pow(1 - f.t, 3);
    c.target.lerpVectors(f.fromT, f.toT, k);
    camera.position.lerpVectors(f.fromP, f.toP, k);
    if (f.t >= 1) flight.current = null;
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      minDistance={2.5}
      maxDistance={48}
      maxPolarAngle={Math.PI * 0.49}
      autoRotate={autoRotate}
      autoRotateSpeed={0.35}
      onStart={() => (flight.current = null)}
    />
  );
}
