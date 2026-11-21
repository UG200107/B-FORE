"use client";

import { motion } from "motion/react";

/** Arcade is hidden for now; Unlimited (Thematic or Random) takes its place. "When" = guess the year. */
export type Mode = "daily" | "when" | "unlimited";

const MODES: { id: Mode; label: string }[] = [
  { id: "daily", label: "Daily" },
  { id: "when", label: "When" },
  { id: "unlimited", label: "Unlimited" },
];

/** Minimal segmented toggle between Daily Rewind, When and Unlimited. */
export function ModeSwitch({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div role="tablist" aria-label="Game mode" className="flex rounded-full border border-zinc-800 bg-zinc-900/60 p-0.5">
      {MODES.map((m) => {
        const active = m.id === mode;
        return (
          <button
            key={m.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(m.id)}
            className={`relative rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              active ? "text-zinc-950" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {active && (
              <motion.span
                layoutId="mode-pill"
                transition={{ type: "spring", stiffness: 600, damping: 38 }}
                className="absolute inset-0 rounded-full bg-zinc-100"
              />
            )}
            <span className="relative">{m.label}</span>
          </button>
        );
      })}
    </div>
  );
}
