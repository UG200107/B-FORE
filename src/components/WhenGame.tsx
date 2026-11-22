"use client";

import { useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useAudioUnlock, useMuted } from "@/hooks/useSound";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useTurnTimer } from "@/hooks/useTurnTimer";
import { MOVE_SECONDS } from "@/lib/gameEngine";
import { LEVELS, LEVEL_LABEL, LEVEL_MOVES, levelRules, type Level } from "@/lib/level";
import {
  SPEED_POINTS,
  WHEN_MAX_POINTS,
  WHEN_MIN_YEAR,
  WHEN_NOW,
  planWhenRound,
  scoreWhenRound,
  splitQuestion,
  toleranceFor,
  whenReducer,
  type WhenAnswer,
  type WhenPool,
} from "@/lib/when";
import { sound } from "@/utils/soundEngine";
import { spinProfile } from "@/utils/spin";
import { recordRound } from "@/utils/stats";
import { formatYear } from "@/utils/timeFormat";
import { EarthCanvas, type EarthTurn } from "./EarthCanvas";
import { DomeEarthDial } from "./DomeEarthDial";
import { EarthDial } from "./EarthDial";
import { ScrollStage, type StagePanel } from "./ScrollStage";
import { SpaceBackdrop } from "./SpaceBackdrop";
import { WhenSummary } from "./WhenSummary";
import { YearInput, YearReadout } from "./YearReadout";

const LEVEL_ACTIVE: Record<Level, string> = {
  easy: "border-emerald-400/60 bg-emerald-400/10 text-emerald-200",
  medium: "border-amber-400/60 bg-amber-400/10 text-amber-200",
  hard: "border-rose-400/60 bg-rose-400/10 text-rose-200",
};

/** How far back each level's round reaches (see DEPTH in lib/when). */
const REACH: Record<Level, string> = { easy: "the 1400s", medium: "500 BCE", hard: "the Stone Age" };

type Props = {
  /** Every question (the easy-quiz data). */
  pool: WhenPool;
  headerLeft: ReactNode;
  headerActions: ReactNode;
};

/**
 * The "When" mode: the engine asks a question ("In what year was the printing press
 * invented?"), the player dials in the year, and the Earth spins back to the real year.
 * Each question is older than the last, down into ancient history. See lib/when.ts.
 */
export function WhenGame({ pool, headerLeft, headerActions }: Props) {
  useAudioUnlock();
  const [muted, setMuted] = useMuted();
  const [level, setLevel] = useState<Level>("medium");
  const [state, dispatch] = useReducer(whenReducer, null);
  const [roundId, setRoundId] = useState(0);
  const [dial, setDial] = useState(WHEN_NOW);
  const turn = useRef<EarthTurn>({ pending: 0, holding: false });

  const playing = state?.status === "playing";
  const over = state?.status === "over";
  const q = state?.question ?? null;
  const timed = levelRules(state?.level ?? level).timer;
  const n = state?.answers.length ?? 0;
  const last: WhenAnswer | undefined = state?.answers[n - 1];
  const lost = (a?: WhenAnswer) => a?.result === "miss" || a?.result === "timeout";

  /* ---------- Earth: spins back to each revealed year ---------- */
  const earthYear = last ? last.item.year : WHEN_NOW;
  const power = last && !lost(last) ? (last.points + last.speedBonus) / (WHEN_MAX_POINTS + SPEED_POINTS) : 0.15;
  const spinKey = state && n > 0 ? `${roundId}:${n}` : null;
  const spin = spinKey ? { key: spinKey, power } : null;
  const profile = spinProfile(power);
  const misses = state?.answers.filter((a) => lost(a)).length ?? 0;
  const paradoxKey = misses > 0 ? `${roundId}:${misses}` : null;

  useEffect(() => {
    if (!spinKey || !last || lost(last)) return;
    sound.rewind(power, last.result === "exact", []);
    // Only on a new answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinKey]);
  useEffect(() => {
    if (paradoxKey) sound.paradox();
  }, [paradoxKey]);

  /* ---------- Turn flow ---------- */
  const submit = (timeLeftFrac: number | null) => {
    if (!state || !playing || !q) return;
    dispatch({ type: "answer", guess: dial, timeLeftFrac });
    // Start the dial at the year just revealed: the next answer is older, so just roll down.
    setDial(Math.max(WHEN_MIN_YEAR, q.year));
  };
  const onTimeout = () => {
    if (!state || !playing || !q) return;
    dispatch({ type: "timeout" });
    setDial(Math.max(WHEN_MIN_YEAR, q.year));
  };
  const start = (lvl: Level) => {
    setLevel(lvl);
    dispatch({ type: "start", level: lvl, plan: planWhenRound(pool, lvl) });
    setRoundId((r) => r + 1);
    setDial(WHEN_NOW);
  };

  const turnKey = playing ? `${roundId}:${n}` : null;
  const timeLeft = useTurnTimer(MOVE_SECONDS, turnKey, timed && playing, onTimeout);
  const secondsLeft = Math.ceil(timeLeft);
  useEffect(() => {
    if (timed && playing && secondsLeft <= 5 && secondsLeft > 0) sound.countdown(secondsLeft <= 3);
  }, [secondsLeft, timed, playing]);

  /* ---------- Round end ---------- */
  const score = useMemo(() => (state ? scoreWhenRound(state) : null), [state]);
  const endDelay = profile.duration + 1.4;
  const endKey = over ? String(roundId) : null;
  useEffect(() => {
    if (!endKey || !state || !score) return;
    sound.roundEnd(score.rank === "S" || score.rank === "A" ? "victory" : score.total < 0 ? "powerdown" : "resolve", endDelay);
    recordRound({ topicId: "when", score: score.total, rank: score.rank });
    // Once per finished round.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endKey]);

  const summaryPanel: StagePanel | null =
    over && state && score
      ? {
          key: `when:${roundId}`,
          label: "When round summary",
          delay: endDelay,
          node: (
            <WhenSummary
              state={state}
              score={score}
              delay={endDelay}
              onPlayAgain={() => start(state.level)}
              onChangeLevel={() => dispatch({ type: "reset" })}
            />
          ),
        }
      : null;

  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const arcMode = !isDesktop && !!state;
  const earth = (
    <EarthCanvas year={earthYear} spin={spin} paradoxKey={paradoxKey} turnRef={turn} className="h-full w-full" />
  );

  const runningTotal = state ? state.answers.reduce((s, a) => s + a.points + a.speedBonus, 0) : 0;
  const question = q ? splitQuestion(q) : null;

  return (
    <div className="relative flex h-dvh w-full flex-col overflow-clip">
      <SpaceBackdrop />
      <ScrollStage panel={summaryPanel}>
        {/* Top bar: mode switch left, round stats centre (desktop), buttons right. */}
        <header className="relative z-10 mx-auto flex w-full max-w-3xl flex-col gap-2.5 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-6 sm:pt-5 lg:max-w-none lg:flex-row lg:items-center lg:gap-6 lg:px-10 lg:pt-6">
          <div className="flex items-center justify-between gap-3 lg:contents">
            <div className="lg:order-1">{headerLeft}</div>
            <div className="flex items-center gap-2 lg:order-4 lg:ml-auto">
              {headerActions}
              <button
                onClick={() => setMuted(!muted)}
                aria-label={muted ? "Unmute sound" : "Mute sound"}
                aria-pressed={muted}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-800 text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-200"
              >
                {muted ? "🔇" : "🔊"}
              </button>
            </div>
          </div>
          {state && (
            <div className="flex items-center justify-center gap-5 lg:absolute lg:bottom-0 lg:left-1/2 lg:top-6 lg:-translate-x-1/2 lg:gap-9">
              {timed && <Stat label="Time" value={over ? 0 : secondsLeft} warn={secondsLeft <= 5} />}
              <Stat label="Question" value={`${Math.min(n + (playing ? 1 : 0), state.total)}/${state.total}`} />
              <Stat label="Score" value={runningTotal} accent warn={runningTotal < 0} />
            </div>
          )}
        </header>

        <main
          className={`relative z-0 flex flex-col items-center px-4 lg:pt-8 ${
            arcMode ? "min-h-0 flex-1 justify-center" : "min-h-0 flex-1 justify-center"
          }`}
        >
          {/* The question, above the Earth. */}
          <div className="mb-2 flex min-h-[5.5rem] max-w-[min(94vw,46rem)] flex-col items-center text-center">
            {!state ? (
              <>
                <p className="text-[11px] uppercase tracking-[0.25em] text-sky-300/80">When?</p>
                <h1 className="mt-1 text-2xl font-semibold text-zinc-50 lg:text-4xl">Guess the year</h1>
                <p className="mt-1.5 max-w-sm text-sm text-zinc-400">
                  We ask, you dial in the year. Each question goes further back in time.
                </p>
              </>
            ) : q && question ? (
              <AnimatePresence mode="wait">
                <motion.div
                  key={q.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6, transition: { duration: 0.15 } }}
                  className="flex flex-col items-center"
                >
                  <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-amber-300/90 lg:text-xs">
                    {q.category}
                  </p>
                  <h1 className="mt-1 text-2xl font-medium text-zinc-200 lg:text-4xl">
                    {question[0]}
                    <span className="font-bold text-amber-300">{question[1]}</span>
                    {question[2]}
                  </h1>
                  {q.context && <p className="mt-1.5 text-sm text-zinc-500 lg:text-base">{q.context}</p>}
                </motion.div>
              </AnimatePresence>
            ) : null}
          </div>

          {/* The year being dialled, on top of the Earth. */}
          {playing && q && (
            <div className="mb-1 mt-1 lg:mt-2">
              <YearReadout value={dial} onChange={setDial} min={WHEN_MIN_YEAR} max={WHEN_NOW} />
            </div>
          )}

          {arcMode ? (
            <>
              {playing && q && <Hint tolerance={toleranceFor(q.year, state.level)} />}
              <div className="mt-1 flex min-h-8 items-center">
                <AnimatePresence mode="wait">{last && <Verdict key={last.item.id} answer={last} />}</AnimatePresence>
              </div>
            </>
          ) : (
            <>
              <div className="relative aspect-square w-[min(88vw,38dvh)] lg:w-[min(50vw,38dvh)]">
                <EarthDial value={dial} onChange={setDial} min={WHEN_MIN_YEAR} max={WHEN_NOW} disabled={!playing} turnRef={turn}>
                  {earth}
                </EarthDial>
              </div>
              {/* The last answer's verdict, below the Earth. */}
              <div className="mt-2 flex min-h-12 items-center">
                <AnimatePresence mode="wait">{last && <Verdict key={last.item.id} answer={last} />}</AnimatePresence>
              </div>
            </>
          )}
        </main>

        {/* Phones: a big Earth rising from the bottom 40% of the screen; swipe it to turn time. */}
        {arcMode && state && (
          <div className="relative h-[40dvh] flex-none">
            <DomeEarthDial value={dial} onChange={setDial} min={WHEN_MIN_YEAR} max={WHEN_NOW} disabled={!playing} turnRef={turn}>
              {earth}
            </DomeEarthDial>
          </div>
        )}

        <footer
          className={`z-20 mx-auto flex w-full max-w-xl flex-col items-center gap-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-6 lg:pb-[5dvh] ${
            arcMode ? "pointer-events-none absolute inset-x-0 bottom-0 [&>*]:pointer-events-auto" : "relative"
          }`}
        >
          {!state ? (
            <>
              <div className="grid w-full grid-cols-3 gap-2" role="radiogroup" aria-label="Difficulty">
                {LEVELS.map((l) => (
                  <button
                    key={l.id}
                    role="radio"
                    aria-checked={level === l.id}
                    onClick={() => setLevel(l.id)}
                    className={`rounded-2xl border px-3 py-2.5 text-left transition ${
                      level === l.id ? LEVEL_ACTIVE[l.id] : "border-zinc-800 bg-zinc-900/50 text-zinc-200 hover:border-zinc-700"
                    }`}
                  >
                    <div className="text-sm font-semibold">{l.label}</div>
                    <div className="mt-0.5 text-[11px] leading-snug text-zinc-500">
                      {LEVEL_MOVES[l.id]} questions, back to {REACH[l.id]}. {levelRules(l.id).timer ? "30s each." : "No timer."}
                    </div>
                  </button>
                ))}
              </div>
              <button
                onClick={() => start(level)}
                className="w-full rounded-2xl bg-sky-500 py-3.5 font-medium text-zinc-950 transition hover:bg-sky-400"
              >
                Start · {LEVEL_LABEL[level]}
              </button>
            </>
          ) : playing && q ? (
            <>
              {/* Typing is a desktop extra; on phones the Earth is the input. */}
              <div className="hidden w-full lg:block">
                <YearInput
                  value={dial}
                  onChange={setDial}
                  onSubmit={() => submit(timed ? timeLeft / MOVE_SECONDS : null)}
                  min={WHEN_MIN_YEAR}
                  max={WHEN_NOW}
                  focusKey={`${roundId}:${n}`}
                />
              </div>
              {!arcMode && <Hint tolerance={toleranceFor(q.year, state.level)} desktop />}
              <button
                onClick={() => submit(timed ? timeLeft / MOVE_SECONDS : null)}
                className={`rounded-2xl bg-sky-500 py-3.5 font-semibold text-zinc-950 shadow-[0_8px_30px_rgba(0,0,0,0.6)] transition hover:bg-sky-400 ${
                  arcMode ? "w-[min(62vw,15rem)]" : "w-full"
                }`}
              >
                Lock in {formatYear(dial, "year")}
              </button>
              {timed && (
                <div className="h-1 w-full overflow-hidden rounded-full bg-zinc-800/80">
                  <div
                    className={`h-full rounded-full transition-[width] duration-100 ease-linear ${
                      secondsLeft <= 5 ? "bg-rose-500" : secondsLeft <= 10 ? "bg-amber-400" : "bg-sky-400/80"
                    }`}
                    style={{ width: `${(timeLeft / MOVE_SECONDS) * 100}%` }}
                  />
                </div>
              )}
            </>
          ) : null}
        </footer>
      </ScrollStage>
    </div>
  );
}

function Hint({ tolerance, desktop }: { tolerance: number; desktop?: boolean }) {
  return (
    <p className="text-center text-[11px] text-zinc-500">
      Within <span className="font-mono text-zinc-300">±{tolerance}</span> years counts ·{" "}
      {desktop ? (
        <>
          turn the Earth ⟲ to go back in time<span className="hidden lg:inline">, or type it</span>
        </>
      ) : (
        "swipe the Earth ← to go back in time"
      )}
    </p>
  );
}

function Stat({ label, value, accent, warn }: { label: string; value: ReactNode; accent?: boolean; warn?: boolean }) {
  return (
    <div className="flex flex-col items-center leading-none">
      <span className="mb-1 text-[9px] uppercase tracking-[0.2em] text-zinc-500 lg:text-[11px]">{label}</span>
      <span
        className={`flex h-6 items-center font-mono text-lg font-semibold tabular-nums lg:h-9 lg:text-3xl ${
          warn ? "text-rose-400" : accent ? "text-sky-300" : "text-zinc-100"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

/** "Exact! It was 2018 · +600", "Miss: it was 1997 (you said 2004, ±3) · −95", … */
function Verdict({ answer: a }: { answer: WhenAnswer }) {
  const year = formatYear(a.item.year, "year");
  const pts = a.points + a.speedBonus;
  const styles: Record<WhenAnswer["result"], string> = {
    exact: "text-amber-300",
    close: "text-emerald-300",
    range: "text-sky-300",
    miss: "text-rose-400",
    timeout: "text-rose-400",
  };
  const guess = a.guess === null ? "–" : formatYear(a.guess, "year");
  const text =
    a.result === "timeout"
      ? `Time's up · it was ${year} · −${-a.points}`
      : a.result === "miss"
        ? `Miss · it was ${year} (you said ${guess}, ±${a.tolerance}) · −${-a.points}`
        : a.result === "exact"
          ? `Exact! It was ${year} · +${pts}`
          : `${a.result === "close" ? "Close" : "In range"} · ${guess} vs ${year} (±${a.tolerance}) · +${pts}`;
  return (
    <motion.p
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className={`text-center text-base font-semibold lg:text-xl ${styles[a.result]}`}
    >
      {text}
    </motion.p>
  );
}
