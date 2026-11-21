"use client";

import { useId, useState } from "react";
import { AnimatePresence, motion, useAnimate } from "motion/react";
import type { GuessOutcome } from "@/hooks/useGameState";
import { COMPANY_CAP } from "@/lib/gameEngine";
import type { TopicItem } from "@/types/topic";
import type { GuessMatch } from "@/utils/guessMatch";
import { sound } from "@/utils/soundEngine";

/** Topics whose items are titled works ("Title not recognized"). */
const TITLE_NOUNS = new Set(["game", "movie", "TV show", "album", "book", "anime"]);

type Notice = { tone: "error" | "lock"; text: string };

type Props = {
  resolve: (text: string) => GuessMatch;
  onGuess: (item: TopicItem) => GuessOutcome;
  /** Item noun ("game", "reptile") for the placeholder and error copy. */
  noun: string;
  /** What the topic calls `company` — the 3-strike cap ("Studio", "Label"). */
  capLabel: string;
  /** What the topic calls `franchise` — the franchise lock ("Series", "Artist"). */
  franchiseLabel: string;
  disabled?: boolean;
};

function lockText(outcome: Extract<GuessOutcome, { ok: false }>, capLabel: string, franchiseLabel: string): string {
  const { item, reason } = outcome;
  switch (reason) {
    case "used":
      return `${item.name} is already on your timeline`;
    case "paradox":
      return `${item.name} already caused a paradox this round`;
    case "franchise":
      return `🔒 ${franchiseLabel} locked — you've already used ${item.franchise}`;
    case "company":
      return `✕ ${item.company} is capped — ${COMPANY_CAP}/${COMPANY_CAP} ${capLabel.toLowerCase()} strikes`;
  }
}

/**
 * Blind guess input: no live suggestions. Enter submits an exact name immediately, asks
 * "Did you mean …?" for aliases/typos (Enter again confirms, Esc or typing dismisses), and
 * shows a free inline error otherwise. Never shows years.
 */
export function GuessInput({ resolve, onGuess, noun, capLabel, franchiseLabel, disabled }: Props) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<TopicItem | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [scope, animate] = useAnimate<HTMLFormElement>();
  const promptId = useId();

  const shake = () => {
    if (scope.current) animate(scope.current, { x: [0, -6, 6, -3, 3, 0] }, { duration: 0.3 });
  };

  const submit = (item: TopicItem) => {
    setPending(null);
    const outcome = onGuess(item);
    if (outcome.ok) {
      setText("");
      setNotice(null);
      if (scope.current) animate(scope.current, { scale: [1, 0.98, 1] }, { duration: 0.18 });
      return;
    }
    setText("");
    setNotice({ tone: "lock", text: lockText(outcome, capLabel, franchiseLabel) });
    sound.nudge();
    shake();
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled) return;
    if (pending) {
      submit(pending);
      return;
    }
    if (!text.trim()) return;
    const match = resolve(text);
    if (match.kind === "exact") {
      submit(match.item);
    } else if (match.kind === "suggest") {
      setNotice(null);
      setPending(match.item);
    } else {
      const label = TITLE_NOUNS.has(noun) ? "Title" : noun.charAt(0).toUpperCase() + noun.slice(1);
      setNotice({ tone: "error", text: `${label} not recognized — check spelling` });
      sound.nudge();
      shake();
    }
  };

  const dismiss = () => setPending(null);

  return (
    <form ref={scope} onSubmit={onSubmit} className="relative" autoComplete="off">
      {/* Prompt / notice slot, directly above the input */}
      <div className="pointer-events-none absolute inset-x-0 bottom-full mb-2 flex flex-col items-stretch">
        <AnimatePresence mode="wait" initial={false}>
          {pending ? (
            <motion.div
              key={`prompt-${pending.id}`}
              id={promptId}
              role="alertdialog"
              aria-label="Did you mean"
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, transition: { duration: 0.12 } }}
              transition={{ type: "spring", stiffness: 600, damping: 36 }}
              className="pointer-events-auto flex flex-col gap-2.5 rounded-2xl border border-sky-500/35 bg-zinc-900/95 px-4 py-3 shadow-2xl shadow-black/60 backdrop-blur sm:flex-row sm:items-center sm:justify-between"
            >
              <p className="text-sm text-zinc-300">
                Did you mean <span className="font-semibold text-zinc-50">“{pending.name}”</span>?
              </p>
              <div className="flex shrink-0 gap-2">
                <button
                  type="submit"
                  onMouseDown={(e) => e.preventDefault()}
                  className="flex-1 rounded-lg bg-sky-500 px-3 py-1.5 text-sm font-medium text-zinc-950 transition hover:bg-sky-400 sm:flex-none"
                >
                  Confirm <kbd className="ml-1 font-mono text-[11px] opacity-70">↵</kbd>
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={dismiss}
                  className="flex-1 rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 transition hover:bg-zinc-800 sm:flex-none"
                >
                  Cancel <kbd className="ml-1 font-mono text-[11px] opacity-60">Esc</kbd>
                </button>
              </div>
            </motion.div>
          ) : notice ? (
            <motion.p
              key={`notice-${notice.text}`}
              role="status"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
              className={`self-center rounded-full border px-3 py-1 text-center text-xs ${
                notice.tone === "error"
                  ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
                  : "border-amber-500/30 bg-amber-500/10 text-amber-200"
              }`}
            >
              {notice.text}
            </motion.p>
          ) : null}
        </AnimatePresence>
      </div>

      <input
        type="text"
        value={text}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          // Typing anything dismisses the prompt and any notice.
          if (pending) setPending(null);
          if (notice) setNotice(null);
        }}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          if (pending) dismiss();
          else if (text) setText("");
          setNotice(null);
        }}
        placeholder={`Name an older ${noun}…`}
        aria-label={`Name an older ${noun}`}
        aria-describedby={pending ? promptId : undefined}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        enterKeyHint="go"
        className="w-full rounded-2xl border border-zinc-800 bg-zinc-900/80 px-4 py-3.5 text-base text-zinc-100 placeholder-zinc-500 outline-none ring-0 ring-sky-500/0 backdrop-blur transition-[border-color,background-color,box-shadow] duration-200 focus:border-sky-500/70 focus:bg-zinc-900 focus:ring-4 focus:ring-sky-500/15 disabled:opacity-40"
      />
    </form>
  );
}
