"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

/** A full-page panel that the game screen scrolls up to reveal. */
export type StagePanel = {
  key: string;
  /** Accessible name for the panel region. */
  label: string;
  node: ReactNode;
  /** Seconds to wait before scrolling (e.g. let the final rewind land first). */
  delay?: number;
};

/** An app-level panel (the Unlimited picker) that takes over from a screen's own panel. */
export const StagePanelOverride = createContext<StagePanel | null>(null);

const EASE = [0.65, 0, 0.35, 1] as const;
const DURATION = 0.75;

/**
 * The game screen and its panel as two stacked pages: opening a panel scrolls the whole
 * screen (header, Earth, input, everything) up and out of view while the panel rises from
 * below to fill the screen, like scrolling to the next page. Closing scrolls back down.
 * Swapping one panel for another (summary → picker) crossfades in place.
 * The space backdrop stays put behind both. No modal, no dimmed overlay.
 *
 * Must sit inside a `relative flex h-dvh flex-col overflow-clip` container: `clip`, not
 * `hidden`, so focusing something mid-slide can't scroll the container and jolt the pages.
 * Panel content marks its default button with `data-autofocus`; it's focused (without
 * scrolling) once the slide has finished.
 */
export function ScrollStage({ panel, children }: { panel: StagePanel | null; children: ReactNode }) {
  const override = useContext(StagePanelOverride);
  const reduceMotion = useReducedMotion();
  const shown = override ?? panel;
  const open = !!shown;
  const delay = shown?.delay ?? 0;
  const move = (d: number) => ({ duration: reduceMotion ? 0 : DURATION, ease: EASE, delay: d });
  const fade = { duration: reduceMotion ? 0 : 0.25, ease: "easeOut" as const };

  // Is this panel REPLACING another one (crossfade in place) or opening from the game (slide
  // up, after `delay`)? Decided once per panel key, from the key that was showing before it.
  // (Re-deriving it from "was open last render" flipped to "swap" on the very render a panel
  // opened, so the end screen faded in instantly instead of waiting for the final animation.)
  const key = shown?.key ?? null;
  const [track, setTrack] = useState<{ key: string | null; swap: boolean }>({ key, swap: false });
  if (track.key !== key) setTrack({ key, swap: track.key !== null && key !== null });
  const swapping = track.key === key ? track.swap : track.key !== null && key !== null;

  return (
    <>
      <motion.div
        inert={open}
        initial={false}
        animate={{ y: open ? "-100%" : "0%" }}
        transition={move(open ? delay : 0)}
        className="relative z-0 flex min-h-0 flex-1 flex-col will-change-transform"
      >
        {children}
      </motion.div>

      <AnimatePresence custom={open}>
        {shown && (
          <motion.section
            key={shown.key}
            aria-label={shown.label}
            custom={open}
            variants={{
              enter: swapping ? { opacity: 0, y: "0%" } : { opacity: 1, y: "100%" },
              shown: { opacity: 1, y: "0%", transition: swapping ? fade : move(delay) },
              // `stillOpen`: another panel is replacing this one → fade; else slide away.
              leave: (stillOpen: boolean) =>
                stillOpen ? { opacity: 0, transition: fade } : { y: "100%", transition: move(0) },
            }}
            initial="enter"
            animate="shown"
            exit="leave"
            onAnimationComplete={(def) => {
              if (def !== "shown") return;
              const el = document.querySelector<HTMLElement>(`[data-stage-panel="${shown.key}"] [data-autofocus]`);
              el?.focus({ preventScroll: true });
            }}
            data-stage-panel={shown.key}
            className="absolute inset-0 z-30 flex flex-col bg-[#03050a]/55 will-change-transform"
          >
            {/* Soft leading edge while the page slides in. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 -top-16 h-16 bg-gradient-to-b from-transparent to-[#03050a]/55"
            />
            {shown.node}
          </motion.section>
        )}
      </AnimatePresence>
    </>
  );
}

/** Shared layout for panel content: a scrolling, vertically centred body and a pinned action bar. */
export function PanelLayout({ children, actions, wide = "lg:max-w-4xl" }: { children: ReactNode; actions: ReactNode; wide?: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-6 lg:pt-10">
        <div className={`mx-auto my-auto w-full max-w-lg pb-4 ${wide}`}>{children}</div>
      </div>
      <div className="border-t border-zinc-800/70 bg-[#03050a]/90 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-6">
        <div className="mx-auto w-full max-w-lg">{actions}</div>
      </div>
    </div>
  );
}
