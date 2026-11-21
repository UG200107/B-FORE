"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { AnimatePresence } from "motion/react";
import { loadTopic } from "@/data/loadTopic";
import { RELAY_TOPICS, STANDALONE_TOPICS } from "@/data/topicsManifest";
import { useDateKey, useMinute } from "@/hooks/useClock";
import { useAudioUnlock } from "@/hooks/useSound";
import {
  TARGET_RACE_MOVES,
  createInitialState,
  oldestYearOf,
  pickSeed,
  type GameState,
  type RoundConfig,
} from "@/lib/gameEngine";
import { MIX_POOL, buildMix, type Mix } from "@/lib/mix";
import type { Topic } from "@/types/topic";
import {
  formatDateKey,
  parseDailyRecord,
  readDailyRaw,
  saveDaily,
  subscribeDaily,
  timeUntilTomorrow,
} from "@/utils/daily";
import { dailyNumber } from "@/utils/shareCard";
import type { ScoreBreakdown } from "@/utils/scoring";
import { recordRound } from "@/utils/stats";
import { EarthCanvas } from "./EarthCanvas";
import { Game } from "./Game";
import { ModeSwitch, type Mode } from "./ModeSwitch";
import { ScrollStage, StagePanelOverride, type StagePanel } from "./ScrollStage";
import { SpaceBackdrop } from "./SpaceBackdrop";
import { StatsButton, StatsModal } from "./StatsModal";
import { UnlimitedSheet, type UnlimitedChoice, type UnlimitedKind } from "./UnlimitedSheet";
import { LEVEL_LABEL, LEVEL_MOVES, LEVEL_SPAN, MIX_SPAN, type Level } from "@/lib/level";

// Arcade (Classic Endless / Target Era Race) is hidden for now; ArcadeSheet.tsx and
// TARGET_RACE_MOVES are kept for when it comes back. Unlimited replaces it.

type UnlimitedSession = {
  kind: UnlimitedKind;
  /** What the picker chose (kind, topic, difficulty, mix topics), to reopen it the same way. */
  choice: UnlimitedChoice;
  /** The chosen topic (Thematic) or the combined Random Mix topic. */
  topic: Topic;
  mix?: Mix;
  config: RoundConfig;
  initial: GameState;
  /** Bumps on every new session so <Game> remounts fresh. */
  nonce: number;
};

/**
 * Round rules for a topic. Classic/Daily rounds aim for seed year − the difficulty's span
 * (Daily = Medium); the hidden Arcade "target" variant keeps its fixed target year.
 */
function configFor(topic: Topic, variant: "classic" | "target" | "daily", level: Level = "medium"): RoundConfig {
  const target = variant === "target" ? (topic.meta.targetYear ?? null) : null;
  return {
    maxMoves: target !== null ? TARGET_RACE_MOVES : LEVEL_MOVES[level],
    targetYear: target,
    oldestYear: oldestYearOf(topic.items),
    span: target === null ? LEVEL_SPAN[level] : null,
  };
}

const KIND_LABEL: Record<UnlimitedKind, string> = {
  thematic: "Unlimited · Thematic",
  random: "Unlimited · Random Mix",
};

/**
 * The Random Mix pool: one equal pool of the 8 standalone mix topics + every fetched relay
 * topic (59). Topics not fetched yet or failing to load are left out. Cached by loadTopic.
 */
async function loadMixPool(): Promise<Topic[]> {
  const ids = [...MIX_POOL, ...RELAY_TOPICS.filter((t) => t.count > 0).map((t) => t.id)];
  const loaded = (await Promise.allSettled(ids.map((id) => loadTopic(id)))).flatMap((r) =>
    r.status === "fulfilled" && r.value.items.length > 0 ? [r.value] : [],
  );
  if (loaded.length < 2) throw new Error("Couldn't load enough topics for the Random Mix");
  return loaded;
}

/**
 * Random Mix rules: no company cap; goal = seed year − MIX_SPAN (100/200/1000 years);
 * distance pays 1,000 at the goal and a quarter rate beyond it (see scoreRound).
 */
function mixConfig(mix: Mix, level: Level): RoundConfig {
  return {
    maxMoves: LEVEL_MOVES[level],
    targetYear: null,
    oldestYear: oldestYearOf(mix.topic.items),
    companyCap: false,
    span: MIX_SPAN[level],
  };
}

type SplashFn = (status?: ReactNode, children?: ReactNode) => ReactNode;

export function App() {
  const [mode, setMode] = useState<Mode>("daily");
  const [session, setSession] = useState<UnlimitedSession | null>(null);
  const [loading, setLoading] = useState<{ name: string; error?: string; retry?: () => void } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const dateKey = useDateKey();
  const headerActions = <StatsButton onClick={() => setStatsOpen(true)} />;
  const closeSheet = useCallback(() => setSheetOpen(false), []);

  const switchMode = (m: Mode) => {
    setMode(m);
    if (m === "unlimited" && !session) setSheetOpen(true);
  };

  /**
   * Thematic: loads the chosen topic. Random: loads every topic in the mix (cached after the
   * first time). Then starts a session from a recent, well-known seed.
   */
  const startUnlimited = async (choice: UnlimitedChoice) => {
    const { kind, topicId } = choice;
    const meta = STANDALONE_TOPICS.find((t) => t.id === topicId) ?? STANDALONE_TOPICS[0];
    const name = kind === "random" ? "the Random Mix" : meta.name;
    setSheetOpen(false);
    setMode("unlimited");
    setLoading({ name });
    try {
      let next: Omit<UnlimitedSession, "nonce">;
      if (kind === "random") {
        const mix = buildMix(await loadMixPool());
        const config = mixConfig(mix, choice.level);
        const seed = mix.pickSeed();
        const seedTopic = mix.topicOf(seed);
        const ask = mix.pickAsk(seed.year, seedTopic, [seed.id], [seedTopic]);
        next = {
          kind,
          choice,
          topic: mix.topic,
          mix,
          config,
          initial: { ...createInitialState(seed, config), ask, asked: ask ? [ask] : [] },
        };
      } else {
        const topic = await loadTopic(meta.id);
        // Thematic keeps the studio/maker strikes (only the Random Mix drops them).
        const config = configFor(topic, "classic", choice.level);
        next = { kind, choice, topic, config, initial: createInitialState(pickSeed(topic.items), config) };
      }
      setSession((prev) => ({ ...next, nonce: (prev?.nonce ?? 0) + 1 }));
      setLoading(null);
    } catch (e) {
      setLoading({ name, error: (e as Error).message, retry: () => void startUnlimited(choice) });
    }
  };

  const headerLeft = (
    <div className="flex items-center gap-3">
      <span className="text-[11px] font-semibold uppercase tracking-[0.35em] text-zinc-500">Bfore</span>
      <ModeSwitch mode={mode} onChange={switchMode} />
    </div>
  );
  const splash: SplashFn = (status, children) => (
    <Splash headerLeft={headerLeft} headerActions={headerActions} status={status}>
      {children}
    </Splash>
  );

  let view: ReactNode;
  if (mode === "daily") {
    view = dateKey ? (
      <DailyView
        key={dateKey}
        dateKey={dateKey}
        splash={splash}
        headerLeft={headerLeft}
        headerActions={headerActions}
        onPlayUnlimited={() => switchMode("unlimited")}
      />
    ) : (
      splash(<LoadingStatus label="Loading today's Daily Rewind" />)
    );
  } else if (loading) {
    view = splash(
      loading.error ? (
        <ErrorStatus message={loading.error} onRetry={loading.retry} />
      ) : (
        <LoadingStatus label={`Loading ${loading.name}`} />
      ),
    );
  } else if (session) {
    const { topic } = session;
    const label = `${KIND_LABEL[session.kind]} · ${LEVEL_LABEL[session.choice.level]}`;
    view = (
      <Game
        key={`unlimited:${session.nonce}`}
        topic={topic}
        mix={session.mix}
        level={session.choice.level}
        config={session.config}
        initial={session.initial}
        contextLabel={label}
        shareLabel={label}
        headerLeft={headerLeft}
        headerActions={headerActions}
        onRoundEnd={(_, score: ScoreBreakdown) =>
          recordRound({ topicId: topic.meta.id, score: score.total, rank: score.rank })
        }
        onTopicClick={() => setSheetOpen(true)}
        summary={{ secondary: { label: "Change Mode", onClick: () => setSheetOpen(true) } }}
      />
    );
  } else {
    view = splash(
      undefined,
      <button
        onClick={() => setSheetOpen(true)}
        className="w-full rounded-2xl bg-sky-500 py-3.5 font-medium text-zinc-950 transition hover:bg-sky-400"
      >
        Choose Thematic or Random
      </button>,
    );
  }

  // The Unlimited picker takes over whichever screen is showing: the screen scrolls up and
  // away and the picker fills the page (replacing a round summary that's open there).
  const pickerPanel: StagePanel | null = sheetOpen
    ? {
        key: "unlimited-picker",
        label: "Choose an Unlimited mode",
        node: (
          <UnlimitedSheet
            topics={STANDALONE_TOPICS}
            mixTopicCount={MIX_POOL.length + RELAY_TOPICS.filter((t) => t.count > 0).length}
            initial={session?.choice}
            onStart={(choice) => void startUnlimited(choice)}
            onClose={closeSheet}
          />
        ),
      }
    : null;

  return (
    <>
      <StagePanelOverride value={pickerPanel}>{view}</StagePanelOverride>
      <AnimatePresence>
        {statsOpen && <StatsModal topics={STANDALONE_TOPICS} todayKey={dateKey} onClose={() => setStatsOpen(false)} />}
      </AnimatePresence>
    </>
  );
}

/* ---------- Daily Rewind: one Random Mix round per day, the same for everyone ---------- */

/** The Daily plays the Random Mix at Medium (30s timer, 100-year goal). */
const DAILY_LEVEL: Level = "medium";

function DailyView(props: {
  dateKey: string;
  splash: SplashFn;
  headerLeft: ReactNode;
  headerActions: ReactNode;
  onPlayUnlimited: () => void;
}) {
  const { dateKey } = props;
  const [pool, setPool] = useState<{ topics: Topic[] | null; error: string | null }>({ topics: null, error: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    loadMixPool().then(
      (topics) => live && setPool({ topics, error: null }),
      (e: Error) => live && setPool({ topics: null, error: e.message }),
    );
    return () => {
      live = false;
    };
  }, [attempt]);
  // Seeded by the date: same seed item and same topic choices for every player today.
  const mix = useMemo(() => (pool.topics ? buildMix(pool.topics, { seed: `daily:${dateKey}` }) : null), [pool.topics, dateKey]);

  if (pool.error)
    return props.splash(
      <ErrorStatus
        message={pool.error}
        onRetry={() => {
          setPool({ topics: null, error: null });
          setAttempt((a) => a + 1);
        }}
      />,
    );
  if (!mix) return props.splash(<LoadingStatus label="Loading today's Daily Rewind" />);
  return (
    <DailyGame
      dateKey={dateKey}
      mix={mix}
      headerLeft={props.headerLeft}
      headerActions={props.headerActions}
      onPlayUnlimited={props.onPlayUnlimited}
    />
  );
}

function DailyGame(props: {
  dateKey: string;
  mix: Mix;
  headerLeft: ReactNode;
  headerActions: ReactNode;
  onPlayUnlimited: () => void;
}) {
  const { dateKey, mix } = props;
  const topic = mix.topic;
  const now = useMinute();
  const seed = useMemo(() => mix.pickSeed(), [mix]);
  const config = useMemo(() => mixConfig(mix, DAILY_LEVEL), [mix]);

  const raw = useSyncExternalStore(
    subscribeDaily,
    () => readDailyRaw(dateKey),
    () => null,
  );
  const record = useMemo(() => parseDailyRecord(raw, topic), [raw, topic]);

  const onRoundEnd = useCallback(
    (state: GameState, score: ScoreBreakdown) => {
      saveDaily(dateKey, { topicId: topic.meta.id, state });
      recordRound({ topicId: topic.meta.id, score: score.total, rank: score.rank, dailyKey: dateKey });
    },
    [dateKey, topic],
  );

  return (
    <Game
      topic={topic}
      mix={mix}
      level={DAILY_LEVEL}
      config={config}
      initial={record?.state ?? null}
      restored={!!record}
      startSeed={seed}
      contextLabel={`Daily Rewind · ${formatDateKey(dateKey)}`}
      shareLabel={`Daily #${dailyNumber(dateKey)}`}
      headerLeft={props.headerLeft}
      headerActions={props.headerActions}
      onRoundEnd={record ? undefined : onRoundEnd}
      summary={{
        primary: { label: "Play Unlimited", onClick: props.onPlayUnlimited },
        footnote: `Daily complete · next Daily Rewind in ${timeUntilTomorrow(now)}`,
      }}
    />
  );
}

/* ---------- Placeholder stage (loading / no Arcade topic yet) ---------- */

function LoadingStatus({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center justify-center gap-3 py-3 text-sm text-zinc-400">
      <span
        aria-hidden
        className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-700 border-t-sky-400 motion-reduce:animate-none"
      />
      {label}…
    </div>
  );
}

function ErrorStatus({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 py-2 text-center">
      <p className="text-sm text-rose-300">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="rounded-xl border border-zinc-700 px-4 py-2 text-sm text-zinc-200 transition hover:bg-zinc-900"
        >
          Retry
        </button>
      )}
    </div>
  );
}

function Splash({
  headerLeft,
  headerActions,
  status,
  children,
}: {
  headerLeft: ReactNode;
  headerActions: ReactNode;
  status?: ReactNode;
  children?: ReactNode;
}) {
  useAudioUnlock();
  return (
    <div className="relative flex h-dvh w-full flex-col overflow-clip">
      <SpaceBackdrop />
      <ScrollStage panel={null}>
      <header className="relative z-10 mx-auto flex w-full max-w-3xl items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-6 sm:pt-5 lg:max-w-none lg:px-10 lg:pt-6">
        {headerLeft}
        {headerActions}
      </header>
      <main className="relative flex min-h-0 flex-1 flex-col items-center justify-center px-4">
        <EarthCanvas
          year={2025}
          className="aspect-square w-[min(94vw,48dvh)] max-w-[620px] lg:w-[min(60vw,54dvh)] [@media(max-height:560px)]:w-[min(70vw,34dvh)]"
        />
      </main>
      <footer className="relative z-20 mx-auto w-full max-w-xl px-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-6 lg:max-w-2xl lg:pb-[7dvh]">
        {status}
        {children}
      </footer>
      </ScrollStage>
    </div>
  );
}
