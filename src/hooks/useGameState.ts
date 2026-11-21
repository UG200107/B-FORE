"use client";

import { useCallback, useMemo, useReducer, useState } from "react";
import type { Topic, TopicItem } from "@/types/topic";
import {
  COMPANY_CAP,
  MAX_LIVES,
  findPulseItem,
  floorYearOf,
  reachedGoal,
  gameReducer,
  getLockReason,
  pickSeed,
  type GameState,
  type LockReason,
  type RoundConfig,
} from "@/lib/gameEngine";
import type { Mix } from "@/lib/mix";
import { createMatcher, type GuessMatch } from "@/utils/guessMatch";
import { nicheness, scoreRound, type MoveScore, type ScoreBreakdown } from "@/utils/scoring";

/** Result of trying to play an item: accepted, or refused (free) because it's locked/used. */
export type GuessOutcome = { ok: true } | { ok: false; reason: LockReason; item: TopicItem };

export type CompanyStrike = { company: string; count: number; capped: boolean };

/**
 * @param topic   dataset being played
 * @param config  moves / target / oldest year applied to every round started here
 * @param initial state to begin with: a restored round, an auto-started one, or null (start screen)
 * @param mix     Random Mix rules: answers must come from the topic each move asks for
 */
export function useGameState(topic: Topic, config: RoundConfig, initial: GameState | null, mix?: Mix) {
  const items = topic.items;
  const [state, dispatch] = useReducer(gameReducer, initial);
  /** Increments each round started from this hook, so animation triggers can tell rounds apart. */
  const [roundId, setRoundId] = useState(0);

  const itemsById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  /** Topic files list items most famous first, so position = fame rank → 0–1 nicheness. */
  const nicheOf = useMemo(() => {
    const niche = new Map(items.map((i, rank) => [i.id, nicheness(rank, items.length)]));
    return (item: TopicItem) => niche.get(item.id) ?? 0;
  }, [items]);

  /** Blind-input resolver: exact name → submit; alias/typo → "Did you mean?"; else nothing. */
  // (The Random Mix matches per asked topic instead of across every item.)
  const matcher = useMemo(() => (mix ? null : createMatcher(items)), [items, mix]);
  const ask = state?.ask ?? null;
  const resolve = useCallback(
    (text: string): GuessMatch => {
      if (mix) return ask ? mix.resolve(ask, text) : { kind: "none" };
      return matcher ? matcher(text) : { kind: "none" };
    },
    [matcher, mix, ask],
  );

  /**
   * Random Mix: a new topic to ask at `year` (see Mix.pickAsk: no dead ends, no repeats of
   * `asked` while avoidable, never `prev` if anything else works). Null outside the mix.
   */
  const nextAsk = useCallback(
    (year: number, prev: string | null, used: string[], asked: string[]): string | null => {
      if (!mix) return null;
      // Prefer a new topic; else allow the previous one if it's still fair. Null = nothing fair
      // is left anywhere: the engine ends the round ("oldest") instead of asking the impossible.
      return mix.pickAsk(year, prev, used, asked) ?? mix.pickAsk(year, null, used, asked);
    },
    [mix],
  );
  /** Topics this round has already used: the seed's and every one asked. */
  const askedIn = useCallback(
    (s: GameState) => (mix ? [mix.topicOf(s.seed), ...(s.asked ?? [])] : []),
    [mix],
  );

  const companyStrikes: CompanyStrike[] = useMemo(() => {
    if (!state || state.companyCap === false) return [];
    return Object.entries(state.companyCounts)
      .map(([company, count]) => ({ company, count, capped: count >= COMPANY_CAP }))
      .sort((a, b) => b.count - a.count || a.company.localeCompare(b.company));
  }, [state]);

  /** Live score; becomes the final breakdown once the round is over. */
  const score: ScoreBreakdown | null = useMemo(() => {
    if (!state) return null;
    return scoreRound({
      chain: state.chain,
      floorYear: floorYearOf(state),
      totalMoves: state.maxMoves,
      maxLives: MAX_LIVES,
      livesLeft: state.lives,
      movesLeft: state.movesLeft,
      reachedGoal: state.status === "over" && (state.endReason === "oldest" || reachedGoal(state)),
      outOfLives: state.endReason === "lives",
      nicheOf,
    });
  }, [state, nicheOf]);

  const moveScores = useMemo(
    () => new Map<string, MoveScore>((score?.moves ?? []).map((m) => [m.itemId, m])),
    [score],
  );

  const pulseItem = useMemo(
    () =>
      state && state.status === "playing"
        ? findPulseItem(state, mix ? (state.ask ? mix.itemsOf(state.ask) : []) : items)
        : null,
    [state, items, mix],
  );
  const canPulse = !!state && !state.pulse.used && !!pulseItem;

  /** Starts a round from `seed`, or a random newest-era seed. Call from event handlers only. */
  const startRound = useCallback(
    (seed?: TopicItem) => {
      const s = seed ?? (mix ? mix.pickSeed() : pickSeed(items));
      dispatch({ type: "start", seed: s, config, ask: mix ? nextAsk(s.year, mix.topicOf(s), [s.id], [mix.topicOf(s)]) : null });
      setRoundId((r) => r + 1);
    },
    [items, config, mix, nextAsk],
  );

  const pulse = useCallback(() => {
    if (pulseItem) dispatch({ type: "pulse", item: pulseItem });
  }, [pulseItem]);

  /**
   * Plays an item. Used, already-paradoxed, franchise-locked and company-capped items are
   * refused up front so they never cost a life or a move; the caller shows the reason.
   */
  const guess = useCallback(
    (item: TopicItem): GuessOutcome => {
      if (!state || state.status !== "playing") return { ok: false, reason: "used", item };
      const reason = getLockReason(state, item);
      if (reason) return { ok: false, reason, item };
      // Random Mix: a rewind asks a new topic from the new year; a paradox (too new) also
      // switches topic, from the unchanged current year.
      const paradox = item.year > state.currentYear;
      const ask = mix
        ? paradox
          ? nextAsk(state.currentYear, state.ask ?? null, state.usedIds, askedIn(state))
          : nextAsk(item.year, state.ask ?? null, [...state.usedIds, item.id], askedIn(state))
        : undefined;
      dispatch({ type: "guess", item, ...(mix ? { ask } : {}) });
      return { ok: true };
    },
    [state, mix, nextAsk, askedIn],
  );

  /** The move's clock ran out (costs a life; the Random Mix switches to a new topic). */
  const timeout = useCallback(() => {
    if (!state || state.status !== "playing") return;
    dispatch(mix ? { type: "timeout", ask: nextAsk(state.currentYear, state.ask ?? null, state.usedIds, askedIn(state)) } : { type: "timeout" });
  }, [state, mix, nextAsk, askedIn]);

  return {
    state,
    roundId,
    timeout,
    itemsById,
    resolve,
    companyStrikes,
    score,
    moveScores,
    canPulse,
    pulse,
    startRound,
    guess,
  };
}
