import { useStore } from "../store/store";

/*
 * Screen-space juice, after BruNet's FX kit: a single canvas overlay that
 * plays short particle bursts and rings. Respects reduced motion and the
 * particle level setting, and sleeps when idle.
 */
interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  ring?: boolean;
}

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
const parts: P[] = [];
let running = false;

function ensure() {
  if (canvas) return;
  canvas = document.createElement("canvas");
  canvas.className = "fx-layer";
  document.body.appendChild(canvas);
  ctx = canvas.getContext("2d");
  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas!.width = innerWidth * dpr;
    canvas!.height = innerHeight * dpr;
    canvas!.style.width = innerWidth + "px";
    canvas!.style.height = innerHeight + "px";
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  addEventListener("resize", resize);
}

function level(): number {
  const { reducedMotion, particles } = useStore.getState().settings;
  if (reducedMotion || particles === "off") return 0;
  return particles === "low" ? 0.4 : 1;
}

function css(name: string, fallback: string) {
  const app = document.querySelector(".app");
  return (app && getComputedStyle(app).getPropertyValue(name).trim()) || fallback;
}

export function burstAt(x: number, y: number, opts: { n?: number; colors?: string[]; speed?: number; ring?: boolean } = {}) {
  const k = level();
  if (!k) return;
  ensure();
  const colors = opts.colors ?? [css("--primary", "#ffb020"), css("--accent", "#4fe3ff"), "#ffffff"];
  const n = Math.round((opts.n ?? 22) * k);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = (opts.speed ?? 3.2) * (0.35 + Math.random() * 0.9);
    const max = 36 + Math.random() * 30;
    parts.push({
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - 1.2,
      life: max,
      max,
      size: 1.5 + Math.random() * 2.5,
      color: colors[i % colors.length],
    });
  }
  if (opts.ring !== false) parts.push({ x, y, vx: 0, vy: 0, life: 28, max: 28, size: 4, color: colors[1] ?? colors[0], ring: true });
  if (!running) {
    running = true;
    requestAnimationFrame(tick);
  }
}

export function burstEl(el: Element | null, opts?: Parameters<typeof burstAt>[2]) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  burstAt(r.left + r.width / 2, r.top + r.height / 2, opts);
}

function tick() {
  if (!ctx || !canvas) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = "lighter";
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.life--;
    if (p.life <= 0) {
      parts.splice(i, 1);
      continue;
    }
    const t = p.life / p.max;
    if (p.ring) {
      const r = (1 - t) * 70 + 4;
      ctx.strokeStyle = p.color;
      ctx.globalAlpha = t * 0.8;
      ctx.lineWidth = 2 * t + 0.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.stroke();
      continue;
    }
    p.vx *= 0.96;
    p.vy = p.vy * 0.96 + 0.06;
    p.x += p.vx;
    p.y += p.vy;
    ctx.globalAlpha = t;
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * (0.5 + t * 0.5), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  if (parts.length) requestAnimationFrame(tick);
  else running = false;
}
