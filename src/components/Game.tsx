"use client";

import { useContext, useEffect, useMemo, type ReactNode } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useTransform } from "motion/react";
import { useGameState, type CompanyStrike } from "@/hooks/useGameState";
import { useAudioUnlock, useMuted } from "@/hooks/useSound";
import { useTurnTimer } from "@/hooks/useTurnTimer";
import { LEVEL_LABEL, levelRules, type Level } from "@/lib/level";

const LEVEL_COLOR: Record<Level, string> = {
  easy: "text-emerald-400",
  medium: "text-amber-400",
  hard: "text-rose-400",
};
import type { Mix } from "@/lib/mix";
import {
  COMPANY_CAP,
  MAX_LIVES,
  MOVE_SECONDS,
  floorYearOf,
  reachedGoal,
  type GameState,
  type GuessResult,
  type RoundConfig,
} from "@/lib/gameEngine";
import type { Difficulty, TimeUnit, Topic, TopicItem, TopicMeta } from "@/types/topic";
import { MAX_MOVE_POINTS, POINT_TIERS, idealJump, optimalJumpRange, type MoveScore, type ScoreBreakdown } from "@/utils/scoring";
import { topicVerb } from "@/data/topicVerbs";
import { buildShareText } from "@/utils/shareCard";
import { sound } from "@/utils/soundEngine";
import { spinProfile, spinProgress } from "@/utils/spin";
import { formatEra, formatYear } from "@/utils/timeFormat";
import { EarthCanvas, type SpinEvent } from "./EarthCanvas";
import { HistoryPills } from "./HistoryPills";
import { EarthBlast } from "./EarthBlast";
import { MoveSlots } from "./MoveSlots";
import { TimelineBar } from "./TimelineBar";
import { RoundSummary, type SummaryAction } from "./RoundSummary";
import { ScorePop } from "./ScorePop";
import { ScrollStage, StagePanelOverride, type StagePanel } from "./ScrollStage";
import { SpaceBackdrop } from "./SpaceBackdrop";
import { GuessInput } from "./GuessInput";
import { YearCounter } from "./YearCounter";

const DIFFICULTY_COLOR: Record<Difficulty, string> = {
  Easy: "text-emerald-400",
  Medium: "text-amber-400",
  Hard: "text-rose-400",
};

type Props = {
  topic: Topic;
  config: RoundConfig;
  /** Round to show on mount: a restored or auto-started round, or null for the start screen. */
  initial: GameState | null;
  /** `initial` is a finished round being revisited: show it without replaying its effects. */
  restored?: boolean;
  /** Seed for the start-screen button (Daily); otherwise a random newest-era seed. */
  startSeed?: TopicItem;
  /** Caption for the start screen and summary, e.g. "Daily Rewind · Fri, Nov 20". */
  contextLabel: string;
  /** Mode label for the share card, e.g. "Daily #42" or "Arcade · Classic Endless". */
  shareLabel: string;
  /** Mode toggle etc., rendered at the left of the top bar. */
  headerLeft: ReactNode;
  /** Arcade: tapping the topic name reopens the picker. */
  onTopicClick?: () => void;
  onRoundEnd?: (state: GameState, score: ScoreBreakdown) => void;
  /** Extra icon buttons (e.g. Stats) shown before the mute toggle. */
  headerActions?: ReactNode;
  /** Summary buttons; primary defaults to "Play Again". */
  summary?: { primary?: SummaryAction; secondary?: SummaryAction; footnote?: string };
  /** Unlimited → Random Mix: each move asks for a different topic. */
  mix?: Mix;
  /** Unlimited difficulty: Easy has no timer; Hard hides every year until the round ends. */
  level?: Level;
};

export function Game(props: Props) {
  const { topic, config, initial, restored = false, startSeed, contextLabel, headerLeft } = props;
  const meta: TopicMeta = topic.meta;
  const unit = meta.timeUnit;
  const { mix } = props;
  const rules = levelRules(props.level ?? "medium");
  const g = useGameState(topic, config, initial, mix);
  const { state, score, roundId } = g;
  /** The topic the next answer must come from (the round's own topic outside the mix). */
  const askMeta: TopicMeta = mix && state?.ask ? mix.metaOf(state.ask) : meta;
  const tagOf = useMemo(() => (mix ? (item: TopicItem) => mix.metaOf(mix.topicOf(item)).noun : undefined), [mix]);

  // Effects are skipped for a revisited (already finished) round until a new one starts.
  const live = !(restored && roundId === 0);

  // reduce, not Math.max(...): Random mixes 100k+ items, too many arguments for one call.
  const newestYear = useMemo(() => topic.items.reduce((m, i) => (i.year > m ? i.year : m), -Infinity), [topic.items]);

  const n = state?.chain.length ?? 0;
  const lastMove = state && n > 1 ? g.moveScores.get(state.chain[n - 1].id) : undefined;
  // The rewind is sized by how well the move scored: better moves spin longer and faster.
  const spinPower = lastMove ? lastMove.points / MAX_MOVE_POINTS : 0;
  const profile = spinProfile(spinPower);
  const spin: SpinEvent | null = live && state && n > 1 ? { key: `${roundId}:${n}`, power: spinPower } : null;
  // Any lost life (paradox or timeout) shakes the Earth and plays the paradox sting.
  const livesLost = state ? MAX_LIVES - state.lives : 0;
  const paradoxKey = live && livesLost > 0 ? `${roundId}:${livesLost}` : null;
  const year = state?.currentYear ?? startSeed?.year ?? newestYear;
  const over = state?.status === "over";
  const spinKey = spin?.key ?? null;
  const optimal = lastMove?.label === "Optimal Jump";

  /* ---------- Audio ---------- */
  useAudioUnlock();
  const [muted, setMuted] = useMuted();

  const movePoints = lastMove?.points ?? 0;
  useEffect(() => {
    if (!spinKey) return;
    if (movePoints === 0) return sound.nudge();
    // Where in the count-up each new colour tier is reached, for its blip.
    const marks = POINT_TIERS.slice(1)
      .filter((t) => movePoints >= t.min)
      .map((t) => t.min / movePoints);
    sound.rewind(movePoints / MAX_MOVE_POINTS, optimal, marks);
  }, [spinKey, movePoints, optimal]);

  useEffect(() => {
    if (paradoxKey) sound.paradox();
  }, [paradoxKey]);

  /* ---------- Move timer ---------- */
  const playing = state?.status === "playing";
  const turnKey = live && state ? `${roundId}:${state.log?.length ?? 0}` : null;
  // Off on Easy; paused while the Unlimited picker has scrolled the round out of the way.
  const covered = useContext(StagePanelOverride) !== null;
  const timed = rules.timer;
  const timeLeft = useTurnTimer(MOVE_SECONDS, turnKey, timed && live && playing && !covered, g.timeout);
  const secondsLeft = Math.ceil(timeLeft);
  useEffect(() => {
    if (timed && live && playing && secondsLeft <= 5 && secondsLeft > 0) sound.countdown(secondsLeft <= 3);
  }, [secondsLeft, live, playing, timed]);

  /** Hard: no years on screen while playing (the Earth's look is the only clock). */
  const hideYears = rules.hideYears && !over;

  const endKey = live && over ? String(roundId) : null;
  const endKind: "victory" | "resolve" | "powerdown" =
    state?.endReason === "lives"
      ? "powerdown"
      : state?.endReason === "oldest" ||
          (state && reachedGoal(state)) ||
          score?.rank === "S" ||
          score?.rank === "A"
        ? "victory"
        : "resolve";
  /** Out of lives in a live round: the Earth blows up (after the last paradox shake lands). */
  const blasted = live && over && state?.endReason === "lives";
  const BLAST_AT = 0.55;
  // Let the final move's rewind and score count land (and be read) first; a blast plays out fully.
  const endDelay = blasted ? BLAST_AT + 2.1 : state?.lastResult?.kind === "valid" ? profile.duration + 1.1 : 0.45;

  useEffect(() => {
    if (!endKey) return;
    if (blasted) sound.blast(BLAST_AT);
    sound.roundEnd(endKind, endDelay);
  }, [endKey, endKind, endDelay, blasted]);

  // Report the finished round once (e.g. to lock today's Daily Rewind).
  const { onRoundEnd } = props;
  useEffect(() => {
    if (endKey && state && score) onRoundEnd?.(state, score);
    // `state` is final once `endKey` is set; re-running on its identity would double-report.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endKey]);

  const onPulse = () => {
    if (!g.canPulse) return;
    g.pulse();
    sound.pulse();
  };

  const playAgain: SummaryAction = { label: "Play Again", onClick: () => g.startRound() };

  const shareText = useMemo(
    () =>
      state && score && state.status === "over"
        ? buildShareText({
            label: props.shareLabel,
            topicName: meta.name,
            unit,
            state,
            score,
            moveScores: g.moveScores,
          })
        : undefined,
    [state, score, g.moveScores, props.shareLabel, meta.name, unit],
  );

  // The end-of-round summary: the screen scrolls up and it rises into the lower half.
  const summaryPanel: StagePanel | null =
    state && score && over
      ? {
          key: `summary:${roundId}`,
          label: "Round summary",
          delay: live ? endDelay : 0,
          node: (
            <RoundSummary
              context={contextLabel}
              endReason={state.endReason}
              targetYear={state.targetYear}
              unit={unit}
              chain={state.chain}
              score={score}
              moveScores={g.moveScores}
              delay={live ? endDelay : 0}
              shareText={shareText}
              primary={props.summary?.primary ?? playAgain}
              secondary={props.summary?.secondary}
              footnote={props.summary?.footnote}
            />
          ),
        }
      : null;

  return (
    <div className="relative flex h-dvh w-full flex-col overflow-clip">
      {/* Deep-space backdrop */}
      <SpaceBackdrop />
      <ScrollStage panel={summaryPanel}>

      {/* Top bar */}
      {/* Phone/tablet: two stacked rows. Desktop (lg): one full-width row, with the mode switch
          and topic on the left, the round stats centred, and Time Pulse and the buttons on the right. */}
      <header className="relative z-10 mx-auto flex w-full max-w-3xl flex-col gap-2.5 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-6 sm:pt-5 lg:max-w-none lg:flex-row lg:items-center lg:gap-6 lg:px-10 lg:pt-6">
        <div className="flex items-center justify-between gap-3 lg:contents">
          <div className="lg:order-1">{headerLeft}</div>
          <div className="flex items-center gap-2 lg:order-4">
            {props.headerActions}
            <MuteButton muted={muted} onToggle={() => setMuted(!muted)} />
          </div>
        </div>
        <div className="flex items-center gap-3 sm:gap-5 lg:contents">
          <button
            type="button"
            onClick={props.onTopicClick}
            disabled={!props.onTopicClick}
            className="group min-w-0 flex-1 text-left disabled:cursor-default lg:order-2 lg:border-l lg:border-zinc-800 lg:pl-6"
            aria-label={props.onTopicClick ? `Change topic (current: ${meta.name})` : undefined}
          >
            <p
              className={`text-[10px] font-semibold uppercase tracking-[0.25em] ${
                props.level ? LEVEL_COLOR[props.level] : mix ? "text-amber-300" : DIFFICULTY_COLOR[meta.difficulty]
              }`}
            >
              {/* Unlimited: the level the player chose (not the topic's own difficulty). */}
              {props.level
                ? `${LEVEL_LABEL[props.level]}${mix ? " · Mixed topics" : ""}`
                : mix
                  ? "Mixed topics"
                  : meta.difficulty}
            </p>
            <h1 className="flex items-center gap-1 truncate text-sm font-medium text-zinc-200 sm:text-base">
              <span className="truncate">{meta.name}</span>
              {props.onTopicClick && (
                <span aria-hidden className="text-zinc-600 transition group-hover:text-zinc-300">
                  ▾
                </span>
              )}
            </h1>
          </button>
          {state && score && (
            <div className="flex shrink-0 items-center gap-3 sm:gap-5 lg:contents">
              {/* Desktop: the round stats sit dead centre of the bar. */}
              <div className="flex items-center gap-3 sm:gap-5 lg:absolute lg:bottom-0 lg:left-1/2 lg:top-6 lg:-translate-x-1/2 lg:gap-9">
              {/* The goal year lives on the timeline bar beside the Earth. */}
              {timed && (
                <div className="hidden lg:block">
                  <TopStat label="Time">
                    <TimerText seconds={over ? 0 : secondsLeft} />
                  </TopStat>
                </div>
              )}
              <TopStat label="Moves">
                <span className="font-mono text-lg font-semibold tabular-nums text-zinc-100 lg:text-3xl">{state.movesLeft}</span>
              </TopStat>
              <TopStat label="Lives">
                <Lives lives={state.lives} />
              </TopStat>
              <TopStat label="Score">
                <CountUp
                  value={score.total}
                  duration={live ? profile.duration : 0}
                  className="font-mono text-lg font-semibold tabular-nums text-sky-300 lg:text-3xl lg:drop-shadow-[0_0_12px_rgba(125,211,252,0.35)]"
                />
              </TopStat>
              </div>
              <button
                onClick={onPulse}
                disabled={!g.canPulse}
                title={
                  state.pulse.used
                    ? "Time Pulse already used this round"
                    : "Time Pulse: reveal the era of a good next guess (once per round)"
                }
                aria-label="Time Pulse"
                className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-violet-400/40 lg:order-3 bg-violet-500/10 px-3 text-sm font-medium text-violet-200 transition hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:bg-transparent disabled:text-zinc-600"
              >
                <span aria-hidden className="text-base leading-none">◎</span>
                <span className="hidden sm:inline">Time Pulse</span>
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Center stage */}
      <main className="relative z-0 flex min-h-0 flex-1 flex-col items-center justify-center px-4">
        {/* Above the Earth: the year, then the optimal-next hint. */}
        <div className="relative flex flex-col items-center gap-1.5">
          {/* Phones only: the score pop above the year (desktop shows it beside the timeline bar). */}
          <div className="pointer-events-none absolute bottom-full left-1/2 mb-1 -translate-x-1/2 lg:hidden">
            <AnimatePresence>
              {spinKey && lastMove && (
                <ScorePop
                  key={spinKey}
                  points={lastMove.points}
                  label={lastMove.label}
                  niche={lastMove.niche}
                  nichePoints={lastMove.nichePoints}
                  duration={profile.duration}
                />
              )}
            </AnimatePresence>
          </div>
          {hideYears ? (
            <div className="flex flex-col items-center" aria-label="Year hidden">
              <span className="font-mono text-[min(2.5rem,11vw)] leading-none font-bold tracking-[0.2em] text-zinc-700 sm:text-5xl lg:text-4xl [@media(max-height:560px)]:text-3xl">
                ????
              </span>
              <span className="mt-1 text-[10px] uppercase tracking-[0.25em] text-rose-300/70">Hard · read the Earth</span>
            </div>
          ) : (
            <YearCounter
              year={year}
              unit={unit}
              duration={profile.duration}
              className="font-mono text-[min(2.5rem,11vw)] leading-none font-bold tabular-nums tracking-tight text-zinc-50 drop-shadow-[0_0_24px_rgba(125,211,252,0.25)] sm:text-5xl lg:text-4xl [@media(max-height:560px)]:text-3xl"
            />
          )}
          {state?.status === "playing" && <OptimalHint state={state} unit={unit} hideYears={hideYears} />}
        </div>

        <div className="relative aspect-square w-[min(90vw,38dvh)] max-w-[620px] lg:w-[min(56vw,46dvh)] [@media(max-height:560px)]:w-[min(60vw,28dvh)]">
          {/* Swells for a beat, then shrinks away under the blast; back to normal next round. */}
          <motion.div
            initial={false}
            animate={blasted ? { scale: [1, 1.08, 0.15], opacity: [1, 1, 0] } : { scale: 1, opacity: 1 }}
            transition={
              blasted ? { delay: BLAST_AT - 0.1, duration: 0.6, times: [0, 0.3, 1], ease: "easeIn" } : { duration: 0.5 }
            }
            className="h-full w-full"
          >
            <EarthCanvas year={year} timeUnit={unit} spin={spin} paradoxKey={paradoxKey} className="h-full w-full" />
          </motion.div>
          {blasted && <EarthBlast key={`blast:${roundId}`} delay={BLAST_AT} seed={roundId + 1} />}
          {/* The range this round has to cover: start (top) → goal (bottom), right of the Earth. */}
          {state && state.targetYear !== null && (
            <TimelineBar
              startYear={state.seed.year}
              goalYear={state.targetYear}
              currentYear={state.currentYear}
              stops={state.chain.slice(1).map((i) => i.year)}
              unit={unit}
              duration={live ? profile.duration : 0}
              hideYears={hideYears}
              reached={state.endReason !== "lives" && state.currentYear <= state.targetYear}
              pop={
                <AnimatePresence>
                  {spinKey && lastMove && (
                    <ScorePop
                      key={spinKey}
                      points={lastMove.points}
                      label={lastMove.label}
                      niche={lastMove.niche}
                      nichePoints={lastMove.nichePoints}
                      duration={profile.duration}
                      placement="side"
                    />
                  )}
                </AnimatePresence>
              }
            />
          )}
        </div>
        {/* Below the Earth: what to guess (the main focus), then the last result / starting point. */}
        <div className="relative mt-[2.5dvh] flex flex-col items-center gap-1.5">
          {state?.status === "playing" && (
            <AskBanner
              meta={askMeta}
              year={state.currentYear}
              after={hideYears ? state.chain[state.chain.length - 1].name : undefined}
            />
          )}
          <StatusLine state={state} moveScores={g.moveScores} meta={askMeta} tagOf={tagOf} hideYears={hideYears} />
        </div>
      </main>

      {/* Desktop: one slot per move down the left edge, filling as answers land. */}
      {state && (
        <aside className="absolute left-10 top-1/2 z-10 hidden w-52 -translate-y-1/2 lg:block xl:w-72">
          <MoveSlots
            chain={state.chain}
            maxMoves={state.maxMoves}
            moveScores={g.moveScores}
            unit={unit}
            tagOf={tagOf}
            hideYears={hideYears}
            playing={state.status === "playing"}
          />
        </aside>
      )}

      {/* Desktop: strikes/locks as a list down the right edge (the dock shows them on smaller screens). */}
      {state && g.companyStrikes.length > 0 && (
        <aside className="absolute right-10 top-1/2 z-10 hidden w-60 -translate-y-1/2 flex-col gap-2 lg:flex">
          <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">{meta.capLabel} strikes</p>
          <Strikes strikes={g.companyStrikes} label={meta.capLabel} vertical />
        </aside>
      )}

      {/* Bottom dock. Desktop: lifted off the bottom edge, with the input above the guessed items. */}
      <footer className="relative z-20 mx-auto flex w-full max-w-xl flex-col gap-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-6 lg:max-w-2xl lg:pb-[7dvh]">
        {!state ? (
          <div className="flex flex-col items-center gap-4 pb-2 text-center">
            <div>
              <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">{contextLabel}</p>
              <p className="mt-1.5 max-w-xs text-sm text-zinc-400">
                {startSeed ? `Starting from ${startSeed.name}${tagOf ? ` (${tagOf(startSeed)})` : ""}. ` : ""}
                {mix
                  ? "Each move names a new topic: answer with something from the same time or earlier."
                  : `Name ${meta.noun}s from the same time or earlier.`}{" "}
                Evenly paced jumps score best. You have {MOVE_SECONDS}s per move.
              </p>
            </div>
            <button
              onClick={() => g.startRound(startSeed)}
              className="w-full rounded-2xl bg-sky-500 py-3.5 font-medium text-zinc-950 transition hover:bg-sky-400"
            >
              Start rewinding
            </button>
          </div>
        ) : (
          <>
            <div className="lg:hidden">
              <Strikes strikes={g.companyStrikes} label={meta.capLabel} />
            </div>
            {/* Phones/tablets only: desktop shows the moves as slots down the left edge. */}
            <div className="lg:hidden">
              <HistoryPills chain={state.chain} moveScores={g.moveScores} unit={unit} tagOf={tagOf} hideYears={hideYears} />
            </div>
            {over ? (
              <button
                onClick={(props.summary?.primary ?? playAgain).onClick}
                className="w-full rounded-2xl lg:order-1 bg-sky-500 py-3.5 font-medium text-zinc-950 transition hover:bg-sky-400"
              >
                {(props.summary?.primary ?? playAgain).label}
              </button>
            ) : (
              <div className="flex flex-col gap-2 lg:order-1">
              <GuessInput
                key={roundId}
                resolve={g.resolve}
                onGuess={g.guess}
                noun={askMeta.noun}
                capLabel={askMeta.capLabel}
                franchiseLabel={askMeta.franchiseLabel}
              />
              {live && timed && <TimerBar left={timeLeft} total={MOVE_SECONDS} />}
              </div>
            )}
          </>
        )}
      </footer>
      </ScrollStage>
    </div>
  );
}

/** Number that counts up to `value` at the rewind's pace (and drops quickly when it falls). */
function CountUp({ value, duration, className }: { value: number; duration: number; className?: string }) {
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => String(Math.round(v)));
  useEffect(() => {
    const rising = value > mv.get();
    const controls = animate(mv, value, rising ? { duration, ease: spinProgress } : { duration: 0.4 });
    return () => controls.stop();
  }, [value, duration, mv]);
  return <motion.span className={className}>{text}</motion.span>;
}

/** Colour of the move clock: calm, then amber at 10s, then red at 5s. */
function timerColor(seconds: number) {
  return seconds <= 5 ? "text-rose-400" : seconds <= 10 ? "text-amber-300" : "text-zinc-100";
}

function TimerText({ seconds }: { seconds: number }) {
  return (
    <motion.span
      key={seconds <= 5 ? seconds : "calm"}
      initial={seconds <= 5 ? { scale: 1.35 } : false}
      animate={{ scale: 1 }}
      transition={{ type: "spring", stiffness: 600, damping: 18 }}
      className={`font-mono text-lg font-semibold tabular-nums lg:text-3xl ${timerColor(seconds)}`}
      aria-label={`${seconds} seconds left`}
    >
      {seconds}
    </motion.span>
  );
}

/** Thin countdown bar under the input, with the seconds at its end. */
function TimerBar({ left, total }: { left: number; total: number }) {
  const s = Math.ceil(left);
  const bar = s <= 5 ? "bg-rose-500" : s <= 10 ? "bg-amber-400" : "bg-sky-400/80";
  return (
    <div className="flex items-center gap-2.5" role="timer" aria-label={`${s} seconds left for this move`}>
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-zinc-800/80">
        <div
          className={`h-full rounded-full transition-[width,background-color] duration-100 ease-linear ${bar}`}
          style={{ width: `${(left / total) * 100}%` }}
        />
      </div>
      <span className={`w-7 text-right font-mono text-xs tabular-nums ${timerColor(s)}`}>{s}s</span>
    </div>
  );
}

function TopStat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex shrink-0 flex-col items-center leading-none">
      <span className="mb-1 text-[9px] uppercase tracking-[0.2em] text-zinc-500 lg:mb-1.5 lg:text-[11px] lg:tracking-[0.25em]">
        {label}
      </span>
      <div className="flex h-6 items-center lg:h-9">{children}</div>
    </div>
  );
}

function Lives({ lives }: { lives: number }) {
  return (
    <span className="flex gap-1 text-base lg:gap-1.5 lg:text-2xl" aria-label={`${lives} lives`}>
      {Array.from({ length: MAX_LIVES }, (_, i) => (
        <span key={i} className="relative inline-flex h-5 w-4 items-center justify-center lg:h-8 lg:w-6">
          <AnimatePresence initial={false}>
            {i < lives ? <Heart key="alive" /> : <LostLife key="lost" />}
          </AnimatePresence>
        </span>
      ))}
    </span>
  );
}

/** A heart that cracks in two and falls away when removed. */
function Heart() {
  const half = (side: "left" | "right") => (
    <motion.span
      variants={{
        crack: {
          x: side === "left" ? -5 : 5,
          y: 6,
          rotate: side === "left" ? -28 : 28,
          transition: { delay: 0.12, duration: 0.45, ease: "easeIn" },
        },
      }}
      className="absolute inset-0 flex items-center justify-center"
      style={{ clipPath: side === "left" ? "inset(0 50% 0 0)" : "inset(0 0 0 50%)" }}
    >
      ♥
    </motion.span>
  );
  return (
    <motion.span
      exit="crack"
      variants={{
        crack: {
          opacity: [1, 1, 0],
          scale: [1, 1.3, 1.1],
          transition: { duration: 0.6, times: [0, 0.2, 1] },
        },
      }}
      className="absolute inset-0 text-rose-500"
    >
      {half("left")}
      {half("right")}
    </motion.span>
  );
}

function LostLife() {
  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.4 }}
      animate={{ opacity: 1, scale: 1, transition: { delay: 0.45, type: "spring", stiffness: 500, damping: 22 } }}
      className="absolute inset-0 flex items-center justify-center text-sm font-bold text-rose-900 lg:text-lg"
      title="Lost to a paradox"
    >
      ✕
    </motion.span>
  );
}

function Strikes({ strikes, label, vertical = false }: { strikes: CompanyStrike[]; label: string; vertical?: boolean }) {
  if (strikes.length === 0) return null;
  return (
    <div
      className={
        vertical
          ? "no-scrollbar flex max-h-[60dvh] flex-col gap-1.5 overflow-y-auto"
          : "no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 py-0.5"
      }
      aria-label={`${label} strikes`}
    >
      <AnimatePresence initial={false}>
        {strikes.map((c) => (
          <motion.div
            key={c.company}
            layout
            initial={{ opacity: 0, scale: 0.8 }}
            animate={c.capped ? "locked" : "open"}
            variants={{
              open: { opacity: 1, scale: 1, x: 0 },
              locked: {
                opacity: 1,
                scale: [1, 1.08, 1],
                x: [0, -6, 6, -4, 4, 0],
                transition: { duration: 0.45, delay: 0.15 },
              },
            }}
            className={[
              "flex shrink-0 items-center gap-1.5 border px-2.5 py-1 text-xs transition-colors duration-300",
              vertical ? "rounded-lg py-1.5 [&>span:last-child]:ml-auto" : "rounded-full",
              c.capped ? "border-red-500/50 bg-red-500/10 text-red-300" : "border-zinc-800 bg-zinc-900/70 text-zinc-400",
            ].join(" ")}
          >
            <AnimatePresence>
              {c.capped && (
                <motion.span
                  initial={{ width: 0, opacity: 0, scale: 0 }}
                  animate={{ width: "auto", opacity: 1, scale: 1 }}
                  transition={{ delay: 0.15, type: "spring", stiffness: 500, damping: 24 }}
                  aria-label="Locked"
                >
                  🔒
                </motion.span>
              )}
            </AnimatePresence>
            <span className={`${vertical ? "min-w-0" : "max-w-[9rem]"} truncate ${c.capped ? "line-through decoration-red-400/60" : ""}`}>
              {c.company}
            </span>
            <span className="flex font-mono text-[11px] font-bold" aria-label={`${c.count} of ${COMPANY_CAP} strikes`}>
              {Array.from({ length: COMPANY_CAP }, (_, i) =>
                i < c.count ? (
                  <motion.span
                    key={`on-${i}`}
                    initial={{ scale: 2.4, opacity: 0, rotate: -45 }}
                    animate={{ scale: 1, opacity: 1, rotate: 0 }}
                    transition={{ type: "spring", stiffness: 700, damping: 20 }}
                    className={c.capped ? "text-red-400" : "text-amber-400"}
                  >
                    ✕
                  </motion.span>
                ) : (
                  <span key={`off-${i}`} className="text-zinc-700">
                    ✕
                  </span>
                ),
              )}
            </span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function MuteButton({ muted, onToggle }: { muted: boolean; onToggle: () => void }) {
  return (
    <motion.button
      onClick={onToggle}
      whileTap={{ scale: 0.88 }}
      aria-label={muted ? "Unmute sound" : "Mute sound"}
      aria-pressed={muted}
      title={muted ? "Unmute" : "Mute"}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-800 text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-200"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M11 5 6 9H3v6h3l5 4V5z" fill="currentColor" />
        {muted ? (
          <path d="m22 9-6 6m0-6 6 6" />
        ) : (
          <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
        )}
      </svg>
    </motion.button>
  );
}

/** Random Mix: which topic the next answer must come from. Re-pops each time it changes. */
/**
 * Always-on pacing hint: the optimal year for the next answer (current year − an even step,
 * i.e. the goal distance ÷ moves) and the range that still scores "Optimal Jump". Hard hides
 * years, so it gives the jump size instead.
 */
function OptimalHint({ state, unit, hideYears }: { state: GameState; unit: TimeUnit; hideYears: boolean }) {
  const ideal = idealJump(state.seed.year, floorYearOf(state), state.maxMoves);
  if (ideal <= 0) return null;
  const { min, max } = optimalJumpRange(ideal);
  const best = Math.round(state.currentYear - ideal);
  const newest = Math.round(state.currentYear - min);
  const oldest = Math.round(state.currentYear - max);
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={`${best}:${hideYears}`}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, transition: { duration: 0.12 } }}
        className="mt-1 flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/[0.07] px-3.5 py-1 text-xs text-emerald-100 lg:text-sm"
        aria-label={
          hideYears
            ? `Optimal jump: about ${Math.round(ideal)} years back`
            : `Optimal next year: ${formatYear(best, unit)}, anywhere from ${formatYear(oldest, unit)} to ${formatYear(newest, unit)} scores an optimal jump`
        }
      >
        <span aria-hidden className="text-emerald-300">◎</span>
        {hideYears ? (
          <span>
            Optimal jump: about <span className="font-mono font-semibold tabular-nums">{Math.round(ideal)}</span> years back
          </span>
        ) : (
          <span>
            Optimal next: <span className="font-mono font-semibold tabular-nums text-emerald-300">{formatYear(best, unit)}</span>
            <span className="ml-1.5 text-emerald-200/60">
              ({formatYear(oldest, unit)}–{formatYear(newest, unit)})
            </span>
          </span>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

function AskBanner({ meta, year, after }: { meta: TopicMeta; year: number; after?: string }) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={`${meta.id}:${year}:${after ?? ""}`}
        initial={{ opacity: 0, y: 8, scale: 0.94 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -6, transition: { duration: 0.15 } }}
        transition={{ type: "spring", stiffness: 420, damping: 26 }}
        // Plain text (no box or glow); the topic and the year are the biggest text on screen.
        className="flex max-w-[min(94vw,46rem)] flex-wrap items-baseline justify-center gap-x-2.5 gap-y-0.5 px-2 py-1 text-center lg:gap-x-4"
        role="status"
        aria-live="polite"
      >
        {/* "ELEMENT discovered BFORE 1850": topic and year highlighted and largest; the verb and
            "BFORE" are smaller and plain. Hard has no years, so the last answer stands in. */}
        <span className="text-2xl font-bold uppercase tracking-wide text-amber-300 lg:text-4xl">{meta.noun}</span>
        <span className="text-sm text-zinc-300 lg:text-xl">{topicVerb(meta.id)}</span>
        <span className="text-sm font-semibold uppercase tracking-[0.15em] text-zinc-300 lg:text-xl">Bfore</span>
        {after !== undefined ? (
          <span className="text-2xl font-bold text-sky-300 lg:text-4xl">{after}</span>
        ) : (
          <span className="font-mono text-2xl font-bold tabular-nums text-sky-300 lg:text-4xl">
            {formatYear(year, meta.timeUnit)}
          </span>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

function StatusLine({
  state,
  moveScores,
  meta,
  tagOf,
  hideYears = false,
}: {
  state: GameState | null;
  moveScores: Map<string, MoveScore>;
  meta: TopicMeta;
  /** Random Mix: an item's topic noun ("book"), shown next to the seed. */
  tagOf?: (item: TopicItem) => string;
  /** Hard: never mention a year. */
  hideYears?: boolean;
}) {
  const result: GuessResult | null = state?.lastResult ?? null;
  let text: string | null = null;
  let color = "text-zinc-500";

  if (result?.kind === "valid") {
    const m = moveScores.get(result.item.id);
    text = `${result.item.name}${m ? ` · +${m.points} pts • ${m.label}${m.nichePoints > 0 ? ` • ${m.niche}` : ""}` : ""}`;
    color = "text-emerald-400/90";
  } else if (result?.kind === "paradox") {
    text = hideYears
      ? `Paradox! ${result.item.name} is too new. −1 life`
      : `Paradox! ${result.item.name} is from ${formatYear(result.item.year, meta.timeUnit)}. −1 life`;
    color = "text-rose-400";
  } else if (result?.kind === "timeout") {
    text = "Time's up! −1 life";
    color = "text-rose-400";
  } else if (result?.kind === "rejected") {
    text = `${result.item.name} is locked`;
  }

  // Before the first answer: a clear "Starting from" card for the seed.
  const seed = state && !result ? state.seed : null;
  const seedNoun = seed ? (tagOf ? tagOf(seed) : meta.noun) : "";

  return (
    <div className="flex min-h-12 flex-col items-center gap-1 text-center">
      <AnimatePresence mode="wait">
        {seed ? (
          <motion.div
            key={`seed:${seed.id}`}
            initial={{ opacity: 0, y: 6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, transition: { duration: 0.15 } }}
            transition={{ type: "spring", stiffness: 380, damping: 26 }}
            // A small secondary chip: the main focus is the "Your turn" prompt above it.
            className="flex max-w-[90vw] items-center gap-1.5 truncate rounded-full border border-zinc-700/70 bg-zinc-900/60 px-3 py-1 text-xs text-zinc-400 lg:text-sm"
          >
            <span className="shrink-0 text-[10px] uppercase tracking-[0.2em] text-zinc-500">Starting from</span>
            <span className="truncate font-medium text-zinc-200">{seed.name}</span>
            <span className="shrink-0 text-zinc-500">
              · <span className="uppercase tracking-wider">{seedNoun}</span>
              {hideYears ? "" : ` · ${formatYear(seed.year, meta.timeUnit)}`}
            </span>
          </motion.div>
        ) : (
          text && (
            <motion.p
              key={text}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className={`max-w-[90vw] truncate text-base font-medium lg:text-lg ${color}`}
            >
              {text}
            </motion.p>
          )
        )}
      </AnimatePresence>
      {state?.pulse.hintYear != null && state.status === "playing" && (
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-sm italic text-violet-300/80">
          ◎ Hint: Try a {meta.noun} from {formatEra(state.pulse.hintYear, meta.timeUnit)}
        </motion.p>
      )}
    </div>
  );
}
