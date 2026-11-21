"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { sound } from "@/utils/soundEngine";
import type { EarthTurn } from "./EarthCanvas";

type Props = {
  value: number;
  onChange: (year: number) => void;
  min: number;
  max: number;
  disabled?: boolean;
  /** Shared with <EarthCanvas turnRef>: the planet turns with your swipe. */
  turnRef: { current: EarthTurn };
  /** The Earth (sized and centred on the bottom edge by this component). */
  children: ReactNode;
};

/** The planet is 72px wide in its 128px canvas. */
const PLANET_IN_CANVAS = 72 / 128;
/** Degrees of slow turning per year. */
const DEG_PER_YEAR = 2;
/** Turning faster than this (deg/s) covers more years per degree, like a jog wheel. */
const ACCEL_FROM = 120;
const ACCEL_MAX = 4;
/** Momentum: velocity decays by e^(−FRICTION·t); below STOP_SPEED it halts. */
const FRICTION = 3.5;
const STOP_SPEED = 8;
/** Fastest fling (deg/s), so a flick stays controllable. */
const MAX_FLING = 700;
/** Only the last stretch of the swipe sets the fling speed. */
const FLING_WINDOW_MS = 90;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Further back, each degree covers more years (×1 for the last century, up to ×60 in the Stone Age). */
const eraScale = (value: number, max: number) => clamp((max - value) / 100, 1, 60);
const accelAt = (speed: number) => clamp(1 + Math.max(0, Math.abs(speed) - ACCEL_FROM) / ACCEL_FROM, 1, ACCEL_MAX);

/**
 * Phones: a big Earth rising from the bottom of the screen that you swipe like a jog wheel.
 * Pull it left (anticlockwise) to go back in time, right to come forward; the year on top
 * changes as it turns. Fling it and it keeps spinning, slowing down until it stops.
 */
export function DomeEarthDial({ value, onChange, min, max, disabled, turnRef, children }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const valueRef = useRef(value);
  const acc = useRef(0);
  const drag = useRef<{ id: number; last: number; samples: { t: number; a: number }[]; total: number } | null>(null);
  const fling = useRef<{ v: number; t: number } | null>(null);
  const raf = useRef<number | null>(null);
  const buzzAt = useRef(0);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const stopFling = () => {
    fling.current = null;
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
  };
  useEffect(() => stopFling, []);
  useEffect(() => {
    if (disabled) {
      stopFling();
      turnRef.current.holding = false;
    }
  }, [disabled, turnRef]);

  /** Turn by `d` degrees at `speed` deg/s. Returns false when the range end blocks it. */
  const turnBy = (d: number, speed: number, at: number): boolean => {
    const cur = valueRef.current;
    if ((d < 0 && cur <= min) || (d > 0 && cur >= max)) {
      acc.current = 0;
      return false;
    }
    turnRef.current.pending += d;
    acc.current += (d * accelAt(speed) * eraScale(cur, max)) / DEG_PER_YEAR;
    const whole = Math.trunc(acc.current);
    if (whole !== 0) {
      acc.current -= whole;
      const next = clamp(cur + whole, min, max);
      if (next !== cur) {
        valueRef.current = next;
        onChange(next);
        sound.detent(next < cur);
        if (at - buzzAt.current > 40) {
          buzzAt.current = at;
          navigator.vibrate?.(2);
        }
      }
    }
    return true;
  };

  const runFling = (now: number) => {
    const f = fling.current;
    if (!f) return;
    const dt = Math.min(0.05, (now - f.t) / 1000);
    f.t = now;
    f.v *= Math.exp(-FRICTION * dt);
    if (Math.abs(f.v) < STOP_SPEED || !turnBy(f.v * dt, f.v, now)) {
      stopFling();
      turnRef.current.holding = false;
      return;
    }
    raf.current = requestAnimationFrame(runFling);
  };

  const angleAt = (x: number, y: number) => {
    const r = box.current!.getBoundingClientRect();
    // The dial turns around the planet's centre: the middle of the bottom edge.
    return (Math.atan2(y - r.bottom, x - (r.left + r.width / 2)) * 180) / Math.PI;
  };

  const release = (e: React.PointerEvent) => {
    const s = drag.current;
    if (!s || s.id !== e.pointerId) return;
    drag.current = null;
    // Fling with the speed of the last few pointer moves (none if the finger paused).
    const recent = s.samples.filter((p) => e.timeStamp - p.t <= FLING_WINDOW_MS);
    let v = 0;
    if (recent.length >= 2) {
      const a = recent[0];
      const b = recent[recent.length - 1];
      v = clamp(((b.a - a.a) / Math.max(8, b.t - a.t)) * 1000, -MAX_FLING, MAX_FLING);
    }
    if (Math.abs(v) > STOP_SPEED * 4) {
      fling.current = { v, t: e.timeStamp };
      raf.current = requestAnimationFrame(runFling);
    } else {
      turnRef.current.holding = false;
    }
  };

  const planet = size ? Math.max(80, size.h - 6) : 0;
  const side = (planet * 2) / PLANET_IN_CANVAS;

  return (
    <div
      ref={box}
      onPointerDown={(e) => {
        if (disabled || e.button > 0) return;
        sound.unlock();
        stopFling(); // Grabbing a spinning Earth stops it.
        e.currentTarget.setPointerCapture(e.pointerId);
        turnRef.current.holding = true;
        acc.current = 0;
        const a = angleAt(e.clientX, e.clientY);
        drag.current = { id: e.pointerId, last: a, samples: [{ t: e.timeStamp, a: 0 }], total: 0 };
      }}
      onPointerMove={(e) => {
        const s = drag.current;
        if (!s || s.id !== e.pointerId) return;
        const a = angleAt(e.clientX, e.clientY);
        let d = a - s.last;
        if (d > 180) d -= 360;
        if (d < -180) d += 360;
        s.last = a;
        const prev = s.samples[s.samples.length - 1];
        const speed = (Math.abs(d) / Math.max(1, e.timeStamp - prev.t)) * 1000;
        s.total += d;
        s.samples.push({ t: e.timeStamp, a: s.total });
        if (s.samples.length > 12) s.samples.shift();
        turnBy(d, speed, e.timeStamp);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      className="relative h-full w-full touch-none select-none"
    >
      {size && (
        <div
          className="pointer-events-none absolute"
          style={{ left: size.w / 2 - side / 2, top: size.h - side / 2, width: side, height: side }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
