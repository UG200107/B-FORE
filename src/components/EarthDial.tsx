"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { sound } from "@/utils/soundEngine";
import type { EarthTurn } from "./EarthCanvas";
import { nudgeSteps } from "./YearReadout";

type Props = {
  value: number;
  onChange: (year: number) => void;
  min: number;
  max: number;
  disabled?: boolean;
  /** Shared with <EarthCanvas turn>: the degrees turned here are applied to the planet. */
  turnRef: { current: EarthTurn };
  /** The Earth itself. */
  children: ReactNode;
};

/** Degrees of slow turning per year (a slow full turn ≈ 60 years). */
const DEG_PER_YEAR = 6;
/** Turning faster than this (deg/s) starts to accelerate, like a jog wheel. */
const ACCEL_FROM = 180;
const ACCEL_MAX = 8;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Further back, each degree covers more years (×1 for the last century, up to ×60 in the Stone Age). */
const eraScale = (value: number, max: number) => clamp((max - value) / 100, 1, 60);

/**
 * The Earth as a jog dial: grab it and turn it around its centre. Turning backwards
 * (anticlockwise, the way it rewinds) goes back in time, clockwise goes forward. One click
 * per year; turn faster and each degree covers more years. Mouse wheel: ±1 (Shift ±10).
 * The planet turns with your hand.
 */
export function EarthDial({ value, onChange, min, max, disabled, turnRef, children }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const valueRef = useRef(value);
  const [holding, setHolding] = useState(false);
  const g = useRef<{ id: number; last: number; t: number; speed: number; acc: number } | null>(null);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  /** Step by whole years; returns false when the end of the range blocks the turn. */
  const step = (years: number): boolean => {
    const from = valueRef.current;
    const next = clamp(from + years, min, max);
    if (next === from) return false;
    valueRef.current = next;
    onChange(next);
    sound.detent(next < from);
    return true;
  };

  const angleAt = (x: number, y: number) => {
    const r = box.current!.getBoundingClientRect();
    const dx = x - (r.left + r.width / 2);
    const dy = y - (r.top + r.height / 2);
    return { deg: (Math.atan2(dy, dx) * 180) / Math.PI, dist: Math.hypot(dx, dy) / r.width };
  };

  const release = () => {
    g.current = null;
    turnRef.current.holding = false;
    setHolding(false);
  };

  return (
    <div
      ref={box}
      onPointerDown={(e) => {
        if (disabled || e.button > 0) return;
        sound.unlock();
        e.currentTarget.setPointerCapture(e.pointerId);
        g.current = { id: e.pointerId, last: angleAt(e.clientX, e.clientY).deg, t: e.timeStamp, speed: 0, acc: 0 };
        turnRef.current.holding = true;
        setHolding(true);
      }}
      onPointerMove={(e) => {
        const s = g.current;
        if (!s || s.id !== e.pointerId) return;
        const { deg, dist } = angleAt(e.clientX, e.clientY);
        // Right over the centre the angle is meaningless: wait until the finger moves out.
        if (dist < 0.08) {
          s.last = deg;
          return;
        }
        let d = deg - s.last;
        if (d > 180) d -= 360;
        if (d < -180) d += 360;
        s.last = deg;
        const dt = Math.max(1, e.timeStamp - s.t) / 1000;
        s.t = e.timeStamp;
        s.speed = s.speed * 0.6 + (Math.abs(d) / dt) * 0.4;
        const accel = clamp(1 + Math.max(0, s.speed - ACCEL_FROM) / ACCEL_FROM, 1, ACCEL_MAX);
        s.acc += (d * accel * eraScale(valueRef.current, max)) / DEG_PER_YEAR;
        const whole = Math.trunc(s.acc);
        let moved = true;
        if (whole !== 0) {
          s.acc -= whole;
          moved = step(whole);
          if (!moved) s.acc = 0; // Hard stop at the ends of the range.
        } else if ((d < 0 && valueRef.current <= min) || (d > 0 && valueRef.current >= max)) {
          moved = false;
        }
        if (moved) {
          turnRef.current.pending += d;
        }
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onWheel={(e) => {
        if (disabled) return;
        const [small, big] = nudgeSteps(valueRef.current, max);
        const years = (e.deltaY > 0 ? -1 : 1) * (e.shiftKey ? big : small);
        if (step(years)) {
          turnRef.current.pending += years > 0 ? DEG_PER_YEAR : -DEG_PER_YEAR;
        }
      }}
      className={`relative h-full w-full touch-none select-none ${
        disabled ? "" : holding ? "cursor-grabbing" : "cursor-grab"
      }`}
    >
      {children}
    </div>
  );
}
