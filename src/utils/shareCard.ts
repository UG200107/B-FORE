import type { GameState, MoveEvent } from "@/lib/gameEngine";
import type { TimeUnit } from "@/types/topic";
import type { MoveScore, ScoreBreakdown } from "./scoring";
import { formatYear } from "./timeFormat";

/** Day #1 of Daily Rewind. */
const DAILY_EPOCH = "2026-11-20";

export const SHARE_EMOJI = {
  optimal: "⚡",
  valid: "⏪",
  same: "⏸️",
  paradox: "❌",
  timeout: "⌛",
  goal: "🎯",
} as const;

/** 1-based Daily number for a "YYYY-MM-DD" key (calendar days since the epoch). */
export function dailyNumber(dateKey: string): number {
  const toUtc = (k: string) => {
    const [y, m, d] = k.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(dateKey) - toUtc(DAILY_EPOCH)) / 86_400_000) + 1;
}

/** One emoji per move in play order. Never includes item names or years. */
export function moveEmojis(state: GameState, moveScores: Map<string, MoveScore>): string[] {
  // Rounds saved before the log existed: rebuild from the valid chain (paradoxes unknown).
  const log: MoveEvent[] =
    state.log ?? state.chain.slice(1).map((i) => ({ kind: "valid" as const, itemId: i.id }));

  const out: string[] = log.map((e) => {
    if (e.kind === "paradox") return SHARE_EMOJI.paradox;
    if (e.kind === "timeout") return SHARE_EMOJI.timeout;
    const m = moveScores.get(e.itemId);
    if (!m) return SHARE_EMOJI.valid;
    if (m.label === "Same Year") return SHARE_EMOJI.same;
    if (m.label === "Optimal Jump") return SHARE_EMOJI.optimal;
    return SHARE_EMOJI.valid;
  });

  // The move that hit the target / oldest item becomes the bullseye.
  if (state.endReason === "target" || state.endReason === "oldest") {
    for (let i = log.length - 1; i >= 0; i--) {
      if (log[i].kind === "valid") {
        out[i] = SHARE_EMOJI.goal;
        break;
      }
    }
  }
  return out;
}

export type ShareInput = {
  /** "Daily #42" or "Arcade · Target Era Race". */
  label: string;
  topicName: string;
  unit: TimeUnit;
  state: GameState;
  score: ScoreBreakdown;
  moveScores: Map<string, MoveScore>;
};

/**
 * Wordle-style, spoiler-free result:
 *   🌍 Rewind • Daily #42 (Video Games)
 *   Score: 840 (Rank A) • Reached: 1972
 *   ⏪ ⏪ ⚡ ⏪ ❌ ⏪ 🎯
 */
export function buildShareText({ label, topicName, unit, state, score, moveScores }: ShareInput): string {
  const emojis = moveEmojis(state, moveScores);
  return [
    `🌍 Rewind • ${label} (${topicName})`,
    `Score: ${score.total} (Rank ${score.rank}) • Reached: ${formatYear(state.currentYear, unit)}`,
    emojis.length > 0 ? emojis.join(" ") : "—",
  ].join("\n");
}

/** Clipboard write with a fallback for browsers/contexts without the async Clipboard API. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied or unsupported: try the legacy path below.
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    // Off-screen but selectable; 16px avoids iOS zoom-on-focus.
    ta.style.cssText = "position:fixed;top:0;left:-9999px;opacity:0;font-size:16px;";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length); // iOS Safari
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
