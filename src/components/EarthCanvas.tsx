"use client";

import { useEffect, useRef } from "react";
import { useAnimate, useAnimationFrame, useReducedMotion } from "motion/react";
import type { TimeUnit } from "@/types/topic";
import { spinEnvelope, spinProfile } from "@/utils/spin";
import { SPRITE_COLORS, SPRITES, type PropKind } from "./earth/pixelSprites";

/*
 * 8-bit planet: pixel art drawn into small 128×128 canvases and scaled up with
 * nearest-neighbour sampling. See the rendering-model note on <EarthCanvas> for why the
 * spin is a CSS rotation of cached layers rather than a per-frame redraw.
 */

/* =========================================================================
 * Canvas geometry
 * ========================================================================= */

const S = 128; // buffer size in pixels
const C = S / 2; // planet center
const R = 36; // planet radius in pixels
const CLOUD_OUT = 2.6; // clouds may bulge this far past the rim

/* =========================================================================
 * Color helpers (ImageData is RGBA bytes; we write little-endian ABGR uint32)
 * ========================================================================= */

type RGB = [number, number, number];
const hexRGB = (h: string): RGB => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const pack = ([r, g, b]: RGB): number => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;

/** [shadow, base, highlight] */
type Tri = [number, number, number];
const tri = (a: string, b: string, c: string): Tri => [pack(hexRGB(a)), pack(hexRGB(b)), pack(hexRGB(c))];

/* =========================================================================
 * Eras + palettes
 * ========================================================================= */

export type Era = "modern" | "late" | "vintage" | "historic" | "ancient" | "deep";

export function eraFor(year: number, unit: TimeUnit = "year"): Era {
  if (unit === "mya") return -year >= 1 ? "deep" : "modern";
  if (year >= 2000) return "modern";
  if (year >= 1980) return "late";
  if (year >= 1950) return "vintage";
  if (year >= 1500) return "historic";
  return "ancient";
}

/** 0 = today's continents, 1 = fully merged Pangaea (~220+ MYA). */
export function pangaeaMix(year: number, unit: TimeUnit): number {
  if (unit !== "mya") return 0;
  return Math.min(Math.max((-year - 20) / 200, 0), 1);
}

/** Terrain classes, low → high. */
const ABYSS = 0, OCEAN = 1, COAST = 2, LOW = 3, HIGH = 4, PEAK = 5, CLOUD = 6;
type Palette = { tones: Tri[]; lava: boolean };

const P = (abyss: Tri, ocean: Tri, coast: Tri, low: Tri, high: Tri, peak: Tri, cloud: Tri, lava = false): Palette => ({
  tones: [abyss, ocean, coast, low, high, peak, cloud],
  lava,
});

const CREAM = tri("#cbc597", "#ebe6ba", "#fbf8dd");

const PALETTES: Record<Era, Palette> = {
  modern: P(
    tri("#2f4862", "#3a5873", "#476a88"),
    tri("#3d5a75", "#4c6b8a", "#5c7fa0"),
    tri("#7cb06a", "#9bd27e", "#b9e39a"),
    tri("#5c9558", "#74b064", "#8fc97a"),
    tri("#4a7a49", "#5c9558", "#74b064"),
    tri("#7cb06a", "#9bd27e", "#b9e39a"),
    CREAM,
  ),
  late: P(
    tri("#30465f", "#3b5670", "#486885"),
    tri("#3f5873", "#4e6988", "#5f7c9c"),
    tri("#80ad69", "#9ccd7c", "#b7df97"),
    tri("#5f9257", "#77ad65", "#90c67a"),
    tri("#4d7849", "#5f9257", "#77ad65"),
    tri("#80ad69", "#9ccd7c", "#b7df97"),
    CREAM,
  ),
  vintage: P(
    tri("#34475a", "#42586a", "#506a7f"),
    tri("#42586a", "#506a7f", "#617d93"),
    tri("#8aa86c", "#a5c283", "#bfd79c"),
    tri("#6f8f5c", "#86a86e", "#9ebf84"),
    tri("#5d7a4e", "#6f8f5c", "#86a86e"),
    tri("#8aa86c", "#a5c283", "#bfd79c"),
    CREAM,
  ),
  historic: P(
    tri("#38495a", "#46596a", "#55697c"),
    tri("#46596a", "#55697c", "#677e92"),
    tri("#a8aa72", "#c2c28a", "#d7d6a3"),
    tri("#879a5e", "#9fb173", "#b6c78a"),
    tri("#6f8250", "#879a5e", "#9fb173"),
    tri("#a8aa72", "#c2c28a", "#d7d6a3"),
    CREAM,
  ),
  ancient: P(
    tri("#3c4e5a", "#4b5f6c", "#5a7080"),
    tri("#4b5f6c", "#5a7080", "#6c8597"),
    tri("#c9b47a", "#ddc98f", "#ece0ad"),
    tri("#a4a06a", "#bab57e", "#cdc896"),
    tri("#8a8a58", "#a4a06a", "#bab57e"),
    tri("#c9b47a", "#ddc98f", "#ece0ad"),
    CREAM,
  ),
  deep: P(
    tri("#1c393c", "#24474a", "#2f5b5c"),
    tri("#24474a", "#2f5b5c", "#3d706e"),
    tri("#4f7a3e", "#62914b", "#79a95c"),
    tri("#3f6634", "#4f7a3e", "#62914b"),
    tri("#33552c", "#3f6634", "#4f7a3e"),
    tri("#c4502c", "#e8783c", "#ffb35c"),
    tri("#7d7772", "#9a948d", "#b5afa8"),
    true,
  ),
};

type Slot = { angle: number; kind: PropKind };

/** What stands on the rim in each era (angles in degrees, 0 = top). */
const RIM: Record<Era, Slot[]> = {
  modern: [
    { angle: 0, kind: "skyscrapers" }, { angle: 36, kind: "roundTree" }, { angle: 70, kind: "turbine" },
    { angle: 106, kind: "house" }, { angle: 146, kind: "pine" }, { angle: 190, kind: "skyscrapers" },
    { angle: 230, kind: "roundTree" }, { angle: 268, kind: "mountain" }, { angle: 306, kind: "turbine" },
    { angle: 334, kind: "pine" },
  ],
  late: [
    { angle: 0, kind: "apartment" }, { angle: 36, kind: "roundTree" }, { angle: 70, kind: "radioTower" },
    { angle: 106, kind: "house" }, { angle: 146, kind: "pine" }, { angle: 190, kind: "factory" },
    { angle: 230, kind: "roundTree" }, { angle: 268, kind: "mountain" }, { angle: 306, kind: "house" },
    { angle: 334, kind: "pine" },
  ],
  vintage: [
    { angle: 0, kind: "house" }, { angle: 36, kind: "roundTree" }, { angle: 70, kind: "waterTower" },
    { angle: 106, kind: "house" }, { angle: 146, kind: "pine" }, { angle: 190, kind: "factory" },
    { angle: 230, kind: "roundTree" }, { angle: 268, kind: "mountain" }, { angle: 306, kind: "pine" },
    { angle: 334, kind: "pine" },
  ],
  historic: [
    { angle: 0, kind: "castle" }, { angle: 36, kind: "roundTree" }, { angle: 70, kind: "windmill" },
    { angle: 106, kind: "cottage" }, { angle: 146, kind: "pine" }, { angle: 190, kind: "windmill" },
    { angle: 230, kind: "roundTree" }, { angle: 268, kind: "mountain" }, { angle: 306, kind: "cottage" },
    { angle: 334, kind: "roundTree" },
  ],
  ancient: [
    { angle: 0, kind: "pyramid" }, { angle: 36, kind: "palm" }, { angle: 70, kind: "hut" },
    { angle: 106, kind: "temple" }, { angle: 146, kind: "pine" }, { angle: 190, kind: "pyramid" },
    { angle: 230, kind: "palm" }, { angle: 268, kind: "mountain" }, { angle: 306, kind: "hut" },
    { angle: 334, kind: "roundTree" },
  ],
  deep: [
    { angle: 0, kind: "volcano" }, { angle: 36, kind: "fern" }, { angle: 70, kind: "sauropod" },
    { angle: 106, kind: "cycad" }, { angle: 146, kind: "fern" }, { angle: 190, kind: "volcano" },
    { angle: 230, kind: "cycad" }, { angle: 268, kind: "mountain" }, { angle: 306, kind: "fern" },
    { angle: 334, kind: "pterosaur" },
  ],
};

/* =========================================================================
 * Noise (seeded value noise + fbm)
 * ========================================================================= */

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNoise(seed: number) {
  const rand = mulberry32(seed);
  const perm = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  const p = new Uint16Array(512);
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  const v = new Float32Array(256);
  for (let i = 0; i < 256; i++) v[i] = rand();
  return (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const X = xi & 255;
    const Y = yi & 255;
    const a = v[p[p[X] + Y]];
    const b = v[p[p[X + 1] + Y]];
    const c = v[p[p[X] + Y + 1]];
    const d = v[p[p[X + 1] + Y + 1]];
    const u = xf * xf * (3 - 2 * xf);
    const w = yf * yf * (3 - 2 * yf);
    return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
  };
}

const terrainNoise = makeNoise(1972);
const cloudNoise = makeNoise(2025);

function fbm(n: (x: number, y: number) => number, x: number, y: number, oct: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * n(x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/** Supercontinent: one big landmass with the Tethys Sea biting in from the east. */
function pangaeaHeight(u: number, v: number, noise: number): number {
  const body = 1 - Math.hypot(u + 6, v * 1.1) / 30;
  const tethys = Math.max(0, 1 - Math.hypot(u - 16, v + 3) / 9);
  return 0.32 + noise * 0.45 + body * 0.32 - tethys * 0.4;
}

/* =========================================================================
 * Static tables
 * ========================================================================= */

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const bayerAt = (x: number, y: number) => BAYER[(y & 3) * 4 + (x & 3)];

const LIGHT = (() => {
  const l = [-0.55, -0.6, 0.58];
  const n = Math.hypot(l[0], l[1], l[2]);
  return [l[0] / n, l[1] / n, l[2] / n];
})();

/** Half-width of the pixel disc per row (−1 outside). Shared by terrain, lighting and clip. */
const HW = new Int16Array(S).fill(-1);
for (let y = C - R; y < C + R; y++) {
  const dy = y + 0.5 - C;
  HW[y] = Math.round(Math.sqrt(Math.max(0, R * R - dy * dy)));
}
const inDisc = (x: number, y: number) => HW[y] >= 0 && x >= C - HW[y] && x < C + HW[y];

/**
 * The planet's pixel-stepped silhouette as a CSS clip polygon. It never rotates, so the
 * outline stays perfectly still while the surface turns underneath it.
 */
const RIM_CLIP = (() => {
  const pct = (v: number) => `${((v / S) * 100).toFixed(3)}%`;
  const right: string[] = [];
  const left: string[] = [];
  for (let y = C - R; y < C + R; y++) {
    right.push(`${pct(C + HW[y])} ${pct(y)}`, `${pct(C + HW[y])} ${pct(y + 1)}`);
    left.push(`${pct(C - HW[y])} ${pct(y)}`, `${pct(C - HW[y])} ${pct(y + 1)}`);
  }
  return `polygon(${[...right, ...left.reverse()].join(", ")})`;
})();

const packA = (r: number, g: number, b: number, a: number): number => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;

const SPRITE_PACKED: Record<string, number> = Object.fromEntries(
  Object.entries(SPRITE_COLORS).map(([k, v]) => [k, pack(hexRGB(v))]),
);
const LAVA_HOT = pack(hexRGB("#ffc15e"));

/* Stars: static pixels with a few slow twinklers (deterministic). */
const STARS = (() => {
  const rand = mulberry32(42);
  const out: { i: number; c: number; tw: number }[] = [];
  const colors = ["#f2efc6", "#f2efc6", "#d9c7d0", "#9c8794"].map((h) => pack(hexRGB(h)));
  while (out.length < 46) {
    const x = Math.floor(rand() * S);
    const y = Math.floor(rand() * S);
    if (Math.hypot(x - C, y - C) < R + 20) continue;
    out.push({ i: y * S + x, c: colors[Math.floor(rand() * colors.length)], tw: rand() < 0.25 ? rand() * 6 : -1 });
  }
  return out;
})();

const RED = pack(hexRGB("#ff5a5a"));

/* ---------- Satellite (2000s+): a clear little sprite, not a lone pixel ---------- */
const SATELLITE = [
  ".....r.....",
  "BbBb.S.BbBb",
  "bBbBSsSbBbB",
  "BbBb.S.BbBb",
];
const SAT_ORBIT_RX = 44;
const SAT_ORBIT_RY = 10;
const SAT_ORBIT_TILT = 0.3;
const SAT_ORBIT_MS = 16000;

/* ---------- Moon: a small cratered sphere spinning on its own (tilted) axis ---------- */

/*
 * The moon is an 8-bit sprite on the planet's own pixel scale (hard pixels, banded tones),
 * drawn into its own tiny canvas. Like the Earth's spin, motion is a smooth CSS transform of
 * that finished pixel art: the sprite glides along its orbit as one rigid block (sub-pixel),
 * and is only repainted when its surface turns one texel. Two copies: behind the planet and
 * in front of it, one visible at a time.
 */
const MOON_R = 10; // radius in planet-grid pixels
const MOON_SPRITE = 2 * (MOON_R + 1); // sprite canvas size (pixels)
const MOON_ORBIT_RX = 50;
const MOON_ORBIT_RY = 12;
const MOON_ORBIT_TILT = -0.25;
const MOON_ORBIT_MS = 30000;
/** One texel of surface rotation per step: whole-pixel steps keep it calm (no shimmer). */
const MOON_STEP_MS = 200;
const MOON_AXIS_TILT = -0.35; // radians; tilts the spin axis so craters drift diagonally
const MOON_TW = 48; // equirectangular texture: 48 texels around (one turn ≈ 9.6 s)
const MOON_TH = 24;

/** Surface classes → [shadow, base, lit]. */
const MOON_TONES: Tri[] = [
  tri("#5d5a3d", "#8f8a5c", "#aaa676"), // plain
  tri("#4a4731", "#6f6b47", "#85805a"), // crater floor / dark mare
  tri("#6f6b47", "#a8a375", "#c2bd8c"), // crater rim
];

/** Precomputed cratered surface (wraps around in longitude). */
const MOON_TEX = (() => {
  const tex = new Uint8Array(MOON_TW * MOON_TH);
  const rand = mulberry32(1969);
  const wrapDist = (u: number, v: number, cu: number, cv: number) => {
    const du = Math.min(Math.abs(u - cu), MOON_TW - Math.abs(u - cu));
    return Math.hypot(du, v - cv);
  };
  // A couple of large dark maria.
  const maria = Array.from({ length: 3 }, () => ({ u: rand() * MOON_TW, v: 6 + rand() * 12, r: 4 + rand() * 4 }));
  // Craters with bright rims.
  const craters = Array.from({ length: 12 }, () => ({ u: rand() * MOON_TW, v: 3 + rand() * 18, r: 1.3 + rand() * 2.6 }));
  for (let v = 0; v < MOON_TH; v++) {
    for (let u = 0; u < MOON_TW; u++) {
      let cls = 0;
      for (const m of maria) if (wrapDist(u + 0.5, v + 0.5, m.u, m.v) < m.r) cls = 1;
      for (const c of craters) {
        const d = wrapDist(u + 0.5, v + 0.5, c.u, c.v);
        if (d < c.r - 0.7) cls = 1;
        else if (d < c.r + 0.3) cls = 2;
      }
      tex[v * MOON_TW + u] = cls;
    }
  }
  return tex;
})();

/* =========================================================================
 * Component
 * ========================================================================= */

/** `power`: the move's points ÷ max points (0–1); sets how long and how fast the rewind spins. */
export type SpinEvent = { key: string; power: number };

/** Hand-turning the planet (the When dial): degrees to add this frame, and whether it is held. */
export type EarthTurn = { pending: number; holding: boolean };

type Props = {
  year: number;
  /** How `year` is encoded; `mya` unlocks the deep-time look. */
  timeUnit?: TimeUnit;
  /** Changes identity (by key) on every valid guess to trigger a rewind spin. */
  spin?: SpinEvent | null;
  /** Changes on every paradox to trigger the time-wall flash + shudder. */
  paradoxKey?: string | null;
  /** When set, the player turns the Earth by hand: its pending degrees are applied each frame and the idle spin stops while held. */
  turnRef?: { current: EarthTurn };
  className?: string;
};

/** Idle rotation in degrees per second (one turn ≈ 50 s). */
const IDLE_DEG = 7;
/** Spin profiles are in "band px/s"; convert to degrees per second. */
const PX_TO_DEG = 0.9;
const CLOUD_DEG = 3.5;
const ERA_FADE_MS = 900;
const PARADOX_MS = 900;
/** Sprite animations (blades, beacons, smoke, lava) step at a calm 8 fps. */
const ANIM_MS = 125;

type Layer = { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; img: ImageData; buf: Uint32Array };
type Layers = { space: Layer; terrain: Layer; clouds: Layer; shade: Layer; props: Layer; fx: Layer };
const LAYER_NAMES = ["space", "terrain", "clouds", "shade", "props", "fx"] as const;

function makeLayer(canvas: HTMLCanvasElement | null): Layer | null {
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) return null;
  const img = ctx.createImageData(S, S);
  return { canvas, ctx, img, buf: new Uint32Array(img.data.buffer) };
}
const flush = (l: Layer) => l.ctx.putImageData(l.img, 0, 0);

const LAYER_CLASS = "absolute inset-0 block h-full w-full [image-rendering:pixelated]";

/*
 * Rendering model (why it doesn't shimmer): pixel art is drawn ONCE in the planet's own
 * frame and only redrawn when its content changes (era fade, sprite animation tick). The
 * spin is a smooth CSS rotation of those finished canvases, so pixels turn as rigid blocks
 * instead of being re-sampled at a new angle every frame. Lighting, the silhouette, stars
 * and the moon live on layers that never rotate.
 */
export function EarthCanvas({ year, timeUnit = "year", spin, paradoxKey, turnRef, className }: Props) {
  const era = eraFor(year, timeUnit);
  const targetMix = pangaeaMix(year, timeUnit);
  const reduceMotion = useReducedMotion();

  const refs = useRef<Record<(typeof LAYER_NAMES)[number], HTMLCanvasElement | null>>({
    space: null,
    terrain: null,
    clouds: null,
    shade: null,
    props: null,
    fx: null,
  });
  const layers = useRef<Layers | null>(null);
  const keys = useRef({ terrain: "", clouds: "", props: "", fx: "" });
  const angle = useRef(0);
  const cloudAngle = useRef(0);
  const mix = useRef(targetMix);
  const eraState = useRef({ cur: era, prev: era, at: -Infinity });
  const paradoxAt = useRef(-Infinity);
  const spinRef = useRef<{ start: number; duration: number; peak: number } | null>(null);
  const targetMixRef = useRef(targetMix);
  const moonBack = useRef<HTMLCanvasElement | null>(null);
  const moonFront = useRef<HTMLCanvasElement | null>(null);
  const moonImg = useRef<ImageData | null>(null);
  const moonStep = useRef<number | null>(null);

  useEffect(() => {
    targetMixRef.current = targetMix;
    if (eraState.current.cur !== era) {
      eraState.current = { cur: era, prev: eraState.current.cur, at: performance.now() };
    }
  }, [era, targetMix]);

  useEffect(() => {
    const made = Object.fromEntries(LAYER_NAMES.map((n) => [n, makeLayer(refs.current[n])]));
    if (LAYER_NAMES.some((n) => !made[n])) return;
    layers.current = made as Layers;
    drawShade(layers.current.shade);
    keys.current = { terrain: "", clouds: "", props: "", fx: "" };
    return () => {
      layers.current = null;
    };
  }, []);

  const spinKey = spin?.key ?? null;
  const spinPower = spin?.power ?? 0;
  useEffect(() => {
    if (spinKey === null) return;
    const prof = spinProfile(spinPower);
    // Rewinding time = spinning backwards (counter-clockwise).
    spinRef.current = { start: performance.now(), duration: prof.duration * 1000, peak: -prof.peak * PX_TO_DEG };
  }, [spinKey, spinPower]);

  const [scope, animate] = useAnimate<HTMLDivElement>();
  useEffect(() => {
    if (!paradoxKey || !scope.current) return;
    paradoxAt.current = performance.now();
    animate(scope.current, { x: [0, -16, 14, -10, 7, -3, 0] }, { duration: 0.5, ease: "easeOut" });
  }, [paradoxKey, animate, scope]);

  useAnimationFrame((t, delta) => {
    const L = layers.current;
    if (!L) return;
    const now = performance.now();
    const dt = Math.min(delta, 64) / 1000;

    /* ---- physics → smooth CSS rotation ---- */
    let v = reduceMotion ? 0 : IDLE_DEG;
    const s = spinRef.current;
    if (s) {
      const prog = (now - s.start) / s.duration;
      if (prog >= 1) spinRef.current = null;
      else v += (s.peak - v) * spinEnvelope(prog);
    }
    const hand = turnRef?.current;
    if (hand) {
      if (hand.holding) v = 0;
      angle.current += hand.pending;
      hand.pending = 0;
    }
    angle.current = (angle.current + v * dt) % 360;
    if (!reduceMotion) cloudAngle.current = (cloudAngle.current + CLOUD_DEG * dt) % 360;
    const rot = `rotate(${angle.current.toFixed(3)}deg)`;
    L.terrain.canvas.style.transform = rot;
    L.props.canvas.style.transform = rot;
    L.clouds.canvas.style.transform = `rotate(${cloudAngle.current.toFixed(3)}deg)`;
    mix.current += (targetMixRef.current - mix.current) * Math.min(1, dt * 2.5);

    /* ---- redraw pixel layers only when their content changes ---- */
    const es = eraState.current;
    const eraT = Math.min(1, Math.max(0, (now - es.at) / ERA_FADE_MS));
    const eraStep = Math.round(eraT * 10) / 10;
    const mixStep = Math.round(mix.current * 40) / 40;
    const tick = reduceMotion ? 0 : Math.floor(t / ANIM_MS);
    const lava = PALETTES[es.cur].lava || PALETTES[es.prev].lava;

    const terrainKey = `${es.cur}|${es.prev}|${eraStep}|${mixStep}|${lava ? tick : 0}`;
    if (terrainKey !== keys.current.terrain) {
      keys.current.terrain = terrainKey;
      drawTerrain(L.terrain, es, eraStep, mixStep, tick);
    }
    const cloudEra = eraStep >= 0.5 ? es.cur : es.prev;
    if (cloudEra !== keys.current.clouds) {
      keys.current.clouds = cloudEra;
      drawClouds(L.clouds, PALETTES[cloudEra]);
    }
    const propsKey = `${es.cur}|${es.prev}|${eraStep}|${tick}`;
    if (propsKey !== keys.current.props) {
      keys.current.props = propsKey;
      drawProps(L.props, es, eraStep, tick);
    }
    const paradoxA = Math.max(0, 1 - (now - paradoxAt.current) / PARADOX_MS);
    const fxKey = `${Math.floor(t / 66)}|${es.cur}|${paradoxA > 0 ? Math.round(paradoxA * 12) : 0}`;
    if (fxKey !== keys.current.fx) {
      keys.current.fx = fxKey;
      drawSpaceAndFx(L.space, L.fx, reduceMotion ? 0 : t, es.cur, paradoxA);
    }

    /* ---- the moon: 8-bit sprite, glided smoothly by CSS (sub-pixel), repainted per texel ---- */
    const bc = moonBack.current;
    const fc = moonFront.current;
    const bctx = bc?.getContext("2d");
    const fctx = fc?.getContext("2d");
    if (bc && fc && bctx && fctx) {
      const tm = reduceMotion ? 0 : t;
      const step = Math.floor(tm / MOON_STEP_MS);
      if (step !== moonStep.current) {
        moonStep.current = step;
        const img = (moonImg.current ??= bctx.createImageData(MOON_SPRITE, MOON_SPRITE));
        paintMoon(new Uint32Array(img.data.buffer), step);
        bctx.putImageData(img, 0, 0);
        fctx.putImageData(img, 0, 0);
      }
      const pos = moonAt(tm);
      // translate() % is of the sprite's own size: (centre offset in pixels) / sprite size.
      const move = `translate(${(((pos.x - MOON_SPRITE / 2) / MOON_SPRITE) * 100).toFixed(3)}%, ${(((pos.y - MOON_SPRITE / 2) / MOON_SPRITE) * 100).toFixed(3)}%)`;
      fc.style.transform = bc.style.transform = move;
      fc.style.visibility = pos.front ? "visible" : "hidden";
      bc.style.visibility = pos.front ? "hidden" : "visible";
    }
  });

  const setRef = (name: (typeof LAYER_NAMES)[number]) => (el: HTMLCanvasElement | null) => {
    refs.current[name] = el;
  };
  const canvas = (name: (typeof LAYER_NAMES)[number], rotates = false) => (
    <canvas
      ref={setRef(name)}
      width={S}
      height={S}
      aria-hidden
      className={LAYER_CLASS}
      style={rotates ? { willChange: "transform" } : undefined}
    />
  );

  return (
    <div ref={scope} className={className}>
      <div className="relative h-full w-full" role="img" aria-label={`Earth, year ${year}`}>
        {canvas("space")}
        {/* Far side of the moon's orbit: an 8-bit sprite glided by CSS transform. */}
        <canvas ref={moonBack} width={MOON_SPRITE} height={MOON_SPRITE} aria-hidden className="absolute left-0 top-0 block [image-rendering:pixelated] will-change-transform" style={{ width: `${(MOON_SPRITE / S) * 100}%`, height: `${(MOON_SPRITE / S) * 100}%`, visibility: "hidden" }} />
        <div className="absolute inset-0" style={{ clipPath: RIM_CLIP }}>
          {canvas("terrain", true)}
        </div>
        {canvas("clouds", true)}
        {canvas("shade")}
        {canvas("props", true)}
        {/* Near side of the moon's orbit, in front of the planet. */}
        <canvas ref={moonFront} width={MOON_SPRITE} height={MOON_SPRITE} aria-hidden className="absolute left-0 top-0 block [image-rendering:pixelated] will-change-transform" style={{ width: `${(MOON_SPRITE / S) * 100}%`, height: `${(MOON_SPRITE / S) * 100}%`, visibility: "hidden" }} />
        {canvas("fx")}
      </div>
    </div>
  );
}

/* =========================================================================
 * Layer painters
 * ========================================================================= */

/** Planet surface in its own (unrotated) frame; a 2px margin keeps the clipped rim filled while turning. */
function drawTerrain(l: Layer, es: { cur: Era; prev: Era }, eraT: number, mix: number, tick: number) {
  const { buf } = l;
  buf.fill(0);
  const palNew = PALETTES[es.cur];
  const palOld = PALETTES[es.prev];
  const r2 = (R + 2) ** 2;
  for (let y = C - R - 2; y < C + R + 2; y++) {
    for (let x = C - R - 2; x < C + R + 2; x++) {
      const dx = x + 0.5 - C;
      const dy = y + 0.5 - C;
      if (dx * dx + dy * dy > r2) continue;
      const pal = eraT >= 1 || bayerAt(x, y) < eraT ? palNew : palOld;
      const n = fbm(terrainNoise, dx / 15 + 50, dy / 15 + 50, 4);
      const h = mix > 0.001 ? n * (1 - mix) + pangaeaHeight(dx, dy, n) * mix : n;
      let cls = h < 0.42 ? ABYSS : h < 0.53 ? OCEAN : h < 0.565 ? COAST : h < 0.62 ? LOW : h < 0.68 ? HIGH : PEAK;
      // Lava only on the very highest ground; elsewhere peaks are just highlands.
      if (cls === PEAK && pal.lava && h < 0.73) cls = HIGH;
      let c = pal.tones[cls][1];
      if (cls === PEAK && pal.lava && ((x * 7 + y * 13 + tick) & 7) === 0) c = LAVA_HOT;
      buf[y * S + x] = c;
    }
  }
  flush(l);
}

/** Cloud puffs in their own frame (they drift separately); may bulge past the rim. */
function drawClouds(l: Layer, pal: Palette) {
  const { buf } = l;
  buf.fill(0);
  const T = 0.67;
  const [, base, light] = pal.tones[CLOUD];
  const lim = R + CLOUD_OUT;
  for (let y = Math.floor(C - lim); y < Math.ceil(C + lim); y++) {
    for (let x = Math.floor(C - lim); x < Math.ceil(C + lim); x++) {
      const dx = x + 0.5 - C;
      const dy = y + 0.5 - C;
      const d2 = dx * dx + dy * dy;
      if (d2 > lim * lim) continue;
      const cv = fbm(cloudNoise, dx / 6.5 + 40, dy / 6.5 + 40, 2);
      const inside = d2 <= R * R;
      if (cv > (inside ? T : T + 0.04)) buf[y * S + x] = cv > T + 0.07 ? light : base;
    }
  }
  flush(l);
}

/** Fixed top-left lighting as translucent pixel bands over the disc (never rotates). */
function drawShade(l: Layer) {
  const { buf } = l;
  buf.fill(0);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (!inDisc(x, y)) continue;
      const nx = (x + 0.5 - C) / R;
      const ny = (y + 0.5 - C) / R;
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      const lum = nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2];
      if (lum < 0.12) buf[y * S + x] = packA(18, 12, 30, 120);
      else if (lum < 0.3) buf[y * S + x] = packA(18, 12, 30, 62);
      else if (lum > 0.86) buf[y * S + x] = packA(255, 250, 225, 46);
      else if (lum > 0.76) buf[y * S + x] = packA(255, 250, 225, 22);
    }
  }
  flush(l);
}

/** Era props in the planet's frame: old era sinks, new era rises. */
function drawProps(l: Layer, es: { cur: Era; prev: Era }, eraT: number, tick: number) {
  const { buf } = l;
  buf.fill(0);
  if (eraT < 1 && es.prev !== es.cur) {
    const k = Math.max(0, 1 - eraT * 2);
    if (k > 0) for (const slot of RIM[es.prev]) drawProp(buf, slot, tick, k);
    const k2 = Math.max(0, (eraT - 0.5) * 2);
    if (k2 > 0) for (const slot of RIM[es.cur]) drawProp(buf, slot, tick, k2);
  } else {
    for (const slot of RIM[es.cur]) drawProp(buf, slot, tick, 1);
  }
  flush(l);
}

/** Stars + far-side moon/satellite behind the planet; near-side ones and the paradox flash in front. */
function drawSpaceAndFx(space: Layer, fx: Layer, t: number, era: Era, paradoxA: number) {
  space.buf.fill(0);
  fx.buf.fill(0);
  for (const st of STARS) {
    if (st.tw >= 0 && Math.sin(t / 1400 + st.tw) > 0.7) continue;
    space.buf[st.i] = st.c;
  }

  // (The moon is drawn separately, every frame, on its own hi-res canvases: see drawMoon.)
  if (era === "modern") {
    const a = (t / SAT_ORBIT_MS) * Math.PI * 2 + 2; // phase-offset from the moon
    const sx0 = Math.cos(a) * SAT_ORBIT_RX;
    const sy0 = Math.sin(a) * SAT_ORBIT_RY;
    const sx = Math.round(C + sx0 * Math.cos(SAT_ORBIT_TILT) - sy0 * Math.sin(SAT_ORBIT_TILT));
    const sy = Math.round(C + sx0 * Math.sin(SAT_ORBIT_TILT) + sy0 * Math.cos(SAT_ORBIT_TILT));
    drawSatellite(Math.sin(a) >= 0 ? fx.buf : space.buf, sx, sy, Math.floor(t / 600) % 2 === 0);
  }

  if (paradoxA > 0) {
    const tint = packA(255, 70, 70, Math.round(97 * paradoxA));
    for (let y = C - R - 3; y < C + R + 3; y++) {
      for (let x = C - R - 3; x < C + R + 3; x++) {
        if (inDisc(x, y)) {
          fx.buf[y * S + x] = tint;
          continue;
        }
        const d = Math.hypot(x + 0.5 - C, y + 0.5 - C);
        if (d > R && d <= R + 2.5 && bayerAt(x, y) < paradoxA) fx.buf[y * S + x] = RED;
      }
    }
  }
  flush(space);
  flush(fx);
}

/** Upright satellite sprite centered on (cx, cy); the beacon blinks. */
function drawSatellite(buf: Uint32Array, cx: number, cy: number, beaconOn: boolean) {
  const h = SATELLITE.length;
  const w = SATELLITE[0].length;
  const x0 = cx - Math.floor(w / 2);
  const y0 = cy - Math.floor(h / 2);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const ch = SATELLITE[r][c];
      if (ch === "." || (ch === "r" && !beaconOn)) continue;
      const color = SPRITE_PACKED[ch];
      if (color !== undefined) setPx(buf, x0 + c, y0 + r, color);
    }
  }
}

function setPx(buf: Uint32Array, x: number, y: number, c: number) {
  if (x >= 0 && y >= 0 && x < S && y < S) buf[y * S + x] = c;
}

/** Moon position (planet-grid units) at time `t`, and whether it's on the near side. */
function moonAt(t: number): { x: number; y: number; front: boolean } {
  const m = (t / MOON_ORBIT_MS) * Math.PI * 2;
  const ox = Math.cos(m) * MOON_ORBIT_RX;
  const oy = Math.sin(m) * MOON_ORBIT_RY;
  return {
    x: C + ox * Math.cos(MOON_ORBIT_TILT) - oy * Math.sin(MOON_ORBIT_TILT),
    y: C + ox * Math.sin(MOON_ORBIT_TILT) + oy * Math.cos(MOON_ORBIT_TILT),
    // Near half of the orbit passes in front of the planet, far half behind it.
    front: Math.sin(m) >= 0,
  };
}

/**
 * Paints the 8-bit moon into its sprite buffer (MOON_SPRITE × MOON_SPRITE, centred): each
 * pixel is projected onto the globe, its longitude offset by `spinStep` texels (so the
 * surface turns on a tilted axis), and lit in three hard bands by the Earth's top-left light.
 */
function paintMoon(buf: Uint32Array, spinStep: number) {
  buf.fill(0);
  const c = MOON_SPRITE / 2;
  const ca = Math.cos(MOON_AXIS_TILT);
  const sa = Math.sin(MOON_AXIS_TILT);
  for (let y = 0; y < MOON_SPRITE; y++) {
    for (let x = 0; x < MOON_SPRITE; x++) {
      const nx = (x + 0.5 - c) / MOON_R;
      const ny = (y + 0.5 - c) / MOON_R;
      const d2 = nx * nx + ny * ny;
      if (d2 > 1) continue;
      const nz = Math.sqrt(1 - d2);

      // Surface lookup in the moon's own (axis-tilted) frame.
      const ax = nx * ca + ny * sa;
      const ay = -nx * sa + ny * ca;
      const lon = Math.atan2(ax, nz);
      const lat = Math.asin(Math.max(-1, Math.min(1, ay)));
      const u = (((Math.floor((lon / (2 * Math.PI) + 0.5) * MOON_TW) + spinStep) % MOON_TW) + MOON_TW) % MOON_TW;
      const v = Math.min(MOON_TH - 1, Math.max(0, Math.floor((lat / Math.PI + 0.5) * MOON_TH)));
      const cls = MOON_TEX[v * MOON_TW + u];

      const lum = nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2];
      const band = lum < 0.08 ? 0 : lum > 0.78 ? 2 : 1;
      buf[y * MOON_SPRITE + x] = MOON_TONES[cls][band];
    }
  }
}

/**
 * Draws a sprite standing on the rim at its slot angle (planet frame), inverse-mapping every
 * pixel in its bounding circle into sprite space so there are no holes. `grow` 0..1 reveals
 * rows from the ground up. Only re-run when the era or animation tick changes.
 */
function drawProp(buf: Uint32Array, slot: Slot, tick: number, grow: number) {
  const sprite = SPRITES[slot.kind];
  const frameTicks = Math.max(1, Math.round((sprite.frameMs ?? 300) / ANIM_MS));
  const frame = sprite.frames.length > 1 ? Math.floor(tick / frameTicks) % sprite.frames.length : 0;
  const rows = sprite.frames[frame];
  const h = rows.length;
  const w = rows[0].length;
  const visible = Math.ceil(h * grow);
  if (visible <= 0) return;

  const th = (slot.angle * Math.PI) / 180;
  const ux = Math.sin(th); // outward
  const uy = -Math.cos(th);
  const tx = Math.cos(th); // tangent
  const ty = Math.sin(th);
  const baseR = R - 1.2 + (sprite.lift ?? 0);
  const bx = C + ux * baseR;
  const by = C + uy * baseR;
  const blinkOn = Math.floor(tick / 5) % 2 === 0;
  const lavaHot = tick % 2 === 0;

  const reach = Math.ceil(Math.hypot(w / 2, h)) + 1;
  for (let py = Math.floor(by - reach); py <= Math.ceil(by + reach); py++) {
    for (let px = Math.floor(bx - reach); px <= Math.ceil(bx + reach); px++) {
      const wx = px + 0.5 - bx;
      const wy = py + 0.5 - by;
      const col = Math.floor(wx * tx + wy * ty + w / 2);
      const row = Math.floor(wx * ux + wy * uy);
      if (col < 0 || col >= w || row < 0 || row >= visible) continue;
      const ch = rows[h - 1 - row][col];
      if (ch === "." || (ch === "r" && !blinkOn)) continue;
      let c = SPRITE_PACKED[ch];
      if (c === undefined) continue;
      if (ch === "L" && lavaHot && (col + row) % 2 === 0) c = LAVA_HOT;
      setPx(buf, px, py, c);
    }
  }

  // Smoke puffs drifting up and away (stepped with the animation tick).
  if (sprite.smoke && grow >= 1) {
    const sc = pack(hexRGB(sprite.smoke.color));
    for (let k = 0; k < 3; k++) {
      const phase = ((tick * ANIM_MS) / 1600 + k / 3) % 1;
      if (phase < 0.08) continue;
      const lc = sprite.smoke.col - w / 2 + 0.5 + phase * 3;
      const lr = sprite.smoke.row + 0.5 + phase * 9;
      const sx = Math.floor(bx + tx * lc + ux * lr);
      const sy = Math.floor(by + ty * lc + uy * lr);
      setPx(buf, sx, sy, sc);
      if (phase < 0.6) {
        setPx(buf, sx + 1, sy, sc);
        setPx(buf, sx, sy - 1, sc);
      }
    }
  }
}
