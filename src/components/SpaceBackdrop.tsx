"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion } from "motion/react";

/**
 * Full-screen 8-bit space behind the game, kept deliberately quiet so the Earth stays the
 * focus: a low-res pixel buffer (PX css px per pixel, scaled up with
 * `image-rendering: pixelated`) with sparse, mostly dim stars across the whole viewport
 * and one small, dim distant moon. Deterministic, redrawn only on resize; a few stars twinkle.
 */

const PX = 3; // css px per art pixel (close to the Earth's own pixel size)
const TWINKLE_MS = 260;
const PIXELS_PER_STAR = 420;

type RGB = [number, number, number];

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const pack = ([r, g, b]: RGB, a = 255) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
const shade = ([r, g, b]: RGB, k: number): RGB => [r * k, g * k, b * k].map((v) => Math.max(0, Math.min(255, Math.round(v)))) as RGB;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const dither = (x: number, y: number) => BAYER[(y & 3) * 4 + (x & 3)];

const STAR_COLORS = ["#f2efc6", "#f2efc6", "#d9c7d0", "#9c8794", "#a9c4e8"].map((h) => hex(h));
const ICE = ["#8f88c4", "#a9a3d6", "#6f68a6"].map((h) => hex(h));

// Same top-left light as the Earth.
const L = (() => {
  const v = [-0.62, -0.52, 0.58];
  const m = Math.hypot(...v);
  return v.map((c) => c / m);
})();

type Scene = { w: number; h: number; base: Uint32Array; twinklers: { i: number; c: number; ph: number }[] };

function buildScene(w: number, h: number): Scene {
  const base = new Uint32Array(w * h);
  const covered = new Uint8Array(w * h);
  const rand = mulberry32(7);

  /* Sparse stars across the whole screen, mostly dim. */
  const count = Math.round((w * h) / PIXELS_PER_STAR);
  const stars: { x: number; y: number; c: number; tw: boolean }[] = [];
  for (let k = 0; k < count; k++) {
    const x = Math.floor(rand() * w);
    const y = Math.floor(rand() * h);
    const col = STAR_COLORS[Math.floor(rand() * STAR_COLORS.length)];
    const k2 = rand() < 0.7 ? 0.35 : 0.7;
    stars.push({ x, y, c: pack(shade(col, k2)), tw: rand() < 0.1 });
  }
  for (const s of stars) if (!s.tw) base[s.y * w + s.x] = s.c;

  /* One small, dim distant moon, placed for landscape (desktop) or portrait (phone). */
  const landscape = w > h * 1.15;
  const ice = landscape
    ? { cx: w * 0.87, cy: h * 0.24, r: Math.min(w, h) * 0.035 }
    : { cx: w * 0.9, cy: h * 0.2, r: w * 0.045 };
  drawIce(ice.cx, ice.cy, ice.r, (x, y, c) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    base[y * w + x] = pack(c);
    covered[y * w + x] = 1;
  });

  const twinklers = stars
    .filter((s) => s.tw && !covered[s.y * w + s.x])
    .map((s) => ({ i: s.y * w + s.x, c: s.c, ph: rand() * Math.PI * 2 }));

  return { w, h, base, twinklers };
}

/** Lambert light quantised into 4 steps with ordered dithering, kept dim so it stays background. */
function lit(nx: number, ny: number, nz: number, x: number, y: number) {
  const lam = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
  const q = Math.min(3, Math.floor(lam * 3 + dither(x, y)));
  return [0.1, 0.2, 0.32, 0.45][q];
}

function drawIce(cx: number, cy: number, r: number, put: (x: number, y: number, c: RGB) => void) {
  for (let y = Math.floor(cy - r); y <= cy + r; y++) {
    for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      const nx = (x + 0.5 - cx) / r;
      const ny = (y + 0.5 - cy) / r;
      const d2 = nx * nx + ny * ny;
      if (d2 > 1) continue;
      const nz = Math.sqrt(1 - d2);
      // A few fixed darker "craters" from a cheap hash.
      const hsh = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
      const n = hsh - Math.floor(hsh);
      const c = n > 0.8 ? ICE[2] : n > 0.35 ? ICE[0] : ICE[1];
      put(x, y, shade(c, lit(nx, ny, nz, x, y)));
    }
  }
}

export function SpaceBackdrop() {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let scene: Scene | null = null;
    let img: ImageData | null = null;
    let buf: Uint32Array | null = null;

    const paint = (t: number) => {
      if (!scene || !img || !buf) return;
      buf.set(scene.base);
      for (const s of scene.twinklers) {
        if (reduceMotion || Math.sin(t / 900 + s.ph) > -0.2) buf[s.i] = s.c;
      }
      ctx.putImageData(img, 0, 0);
    };

    const resize = () => {
      const w = Math.max(1, Math.ceil(canvas.clientWidth / PX));
      const h = Math.max(1, Math.ceil(canvas.clientHeight / PX));
      if (scene && scene.w === w && scene.h === h) return;
      canvas.width = w;
      canvas.height = h;
      scene = buildScene(w, h);
      img = ctx.createImageData(w, h);
      buf = new Uint32Array(img.data.buffer);
      paint(performance.now());
    };

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    const id = reduceMotion ? 0 : window.setInterval(() => paint(performance.now()), TWINKLE_MS);
    return () => {
      ro.disconnect();
      window.clearInterval(id);
    };
  }, [reduceMotion]);

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_40%,#06101c_0%,#03050a_50%,#010102_100%)]" />
      <canvas ref={ref} className="absolute left-0 top-0 h-full w-full [image-rendering:pixelated]" />
    </div>
  );
}
