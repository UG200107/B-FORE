"use client";

import { useEffect, useRef, useState } from "react";
import { sound } from "@/utils/soundEngine";
import { formatYear } from "@/utils/timeFormat";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Nudge sizes grow with age: ±1/±10 for recent years, ±10/±100 for ancient ones. */
export function nudgeSteps(value: number, max: number): [number, number] {
  return max - value > 400 ? [10, 100] : [1, 10];
}

type ReadoutProps = {
  value: number;
  onChange: (year: number) => void;
  min: number;
  max: number;
};

/** The chosen year, big ("1440", "500 BCE"), with nudge chips for fine-tuning after turning the Earth. */
export function YearReadout({ value, onChange, min, max }: ReadoutProps) {
  const [small, big] = nudgeSteps(value, max);
  const nudge = (d: number) => {
    const next = clamp(value + d, min, max);
    if (next !== value) {
      onChange(next);
      sound.detent(d < 0);
    }
  };

  const chip = (d: number) => (
    <button
      type="button"
      tabIndex={-1}
      onClick={() => nudge(d)}
      aria-label={`${d > 0 ? "Forward" : "Back"} ${Math.abs(d)} year${Math.abs(d) > 1 ? "s" : ""}`}
      className="h-9 min-w-10 rounded-full border border-zinc-700/80 bg-zinc-900/80 px-2 font-mono text-xs sm:min-w-11 sm:px-2.5 sm:text-sm font-semibold text-zinc-300 shadow-[0_2px_0_rgba(0,0,0,0.5)] transition hover:border-zinc-500 hover:text-zinc-50 active:translate-y-px active:shadow-none"
    >
      {d > 0 ? `+${d}` : `−${Math.abs(d)}`}
    </button>
  );

  const bce = value < 0;
  return (
    <div className="flex items-center justify-center gap-1.5 sm:gap-3">
      {chip(-big)}
      {chip(-small)}
      <output
        aria-live="off"
        aria-label="Your year"
        className="flex min-w-[4.6ch] items-baseline justify-center whitespace-nowrap text-center font-mono font-black tabular-nums leading-none tracking-tight text-zinc-50"
      >
        <span className={bce || Math.abs(value) >= 10000 ? "text-4xl sm:text-6xl" : "text-5xl sm:text-6xl"}>{Math.abs(value)}</span>
        {bce && <span className="ml-1 text-sm font-bold text-amber-300 sm:ml-1.5 sm:text-xl">BCE</span>}
      </output>
      {chip(small)}
      {chip(big)}
    </div>
  );
}

type InputProps = {
  value: number;
  onChange: (year: number) => void;
  onSubmit: () => void;
  min: number;
  max: number;
  /** Changes when a new question appears: focuses the box again. */
  focusKey?: string;
};

/**
 * Desktop typing bar: type the year, pick CE / BCE, Enter locks it in (↑/↓ nudge, Shift ×10;
 * typing "-" or "b" switches to BCE, "+" or "c" back to CE). Kept in step with the Earth dial
 * both ways.
 */
export function YearInput({ value, onChange, onSubmit, min, max, focusKey }: InputProps) {
  const ref = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(String(Math.abs(value)));
  const [bce, setBce] = useState(value < 0);
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    setSynced(value);
    const typed = (bce ? -1 : 1) * Number(text);
    if (typed !== value) {
      setText(String(Math.abs(value)));
      setBce(value < 0);
    }
  }
  useEffect(() => {
    const el = ref.current;
    if (el && el.offsetParent !== null && window.matchMedia("(pointer: fine)").matches) {
      el.focus({ preventScroll: true });
      el.select();
    }
  }, [focusKey]);

  const apply = (digits: string, isBce: boolean) => {
    if (!digits) return;
    const y = (isBce ? -1 : 1) * Number(digits);
    if (y >= min && y <= max) onChange(y);
  };
  const typed = (bce ? -1 : 1) * Number(text);
  const out = text !== "" && (typed < min || typed > max);

  const eraButton = (isBce: boolean) => (
    <button
      type="button"
      tabIndex={-1}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        setBce(isBce);
        apply(text, isBce);
      }}
      aria-pressed={bce === isBce}
      className={`rounded-lg px-2 py-1 text-xs font-semibold transition ${
        bce === isBce ? "bg-zinc-100 text-zinc-950" : "text-zinc-500 hover:text-zinc-200"
      }`}
    >
      {isBce ? "BCE" : "CE"}
    </button>
  );

  return (
    <label className="flex w-full items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/70 px-4 py-2 focus-within:border-sky-500/60">
      <span className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">Type the year</span>
      <input
        ref={ref}
        value={text}
        inputMode="numeric"
        autoComplete="off"
        maxLength={5}
        placeholder="YYYY"
        aria-label="Type the year"
        onChange={(e) => {
          const raw = e.target.value;
          let isBce = bce;
          if (/[-bB]/.test(raw)) isBce = true;
          else if (/[+cC]/.test(raw)) isBce = false;
          const t = raw.replace(/\D/g, "").slice(0, 5);
          setBce(isBce);
          setText(t);
          apply(t, isBce);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (text !== "" && !out) onSubmit();
          } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const [s, b] = nudgeSteps(value, max);
            const next = clamp(value + (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? b : s), min, max);
            if (next !== value) {
              onChange(next);
              sound.detent(next < value);
            }
          }
        }}
        className="w-[6ch] min-w-0 flex-1 bg-transparent font-mono text-2xl font-bold tabular-nums tracking-widest text-zinc-50 outline-none placeholder:text-zinc-700"
      />
      <div className="flex rounded-xl border border-zinc-800 p-0.5">
        {eraButton(false)}
        {eraButton(true)}
      </div>
      <span className={`w-28 text-right text-xs ${out ? "text-rose-400" : "text-zinc-600"}`}>
        {out ? `${formatYear(min, "year")}–${max} only` : "Enter ↵"}
      </span>
    </label>
  );
}
