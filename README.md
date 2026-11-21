# Bfore — Rewind Time

A minimalist, dark-mode web game: spin a 2D Earth back through history by naming
items that are **older than or equal to** the current year. See [`bfore.md`](bfore.md)
for the full design.

- **Daily Rewind** — same topic and seed for everyone each day (local date), 10 moves,
  locked once completed. Spoiler-free emoji share card + streaks.
- **Arcade** — any topic, *Classic Endless* (10 moves) or *Target Era Race*
  (reach the topic's target in 8 moves).
- **Rules** — paradoxes (newer guesses) cost 1 of 3 lives; franchise lock;
  3-strike company/order cap; one Time Pulse hint per round. Each move scores up to 500:
  350 for pacing (jump efficiency) + 150 for how niche the answer is (its fame rank in the
  topic file, log scale). S/A/B/C ranks are judged against perfect pacing, so niche answers
  lift you. The rewind spins longer and faster the more a move scored, with the points
  counting up in colour tiers as it spins.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS 4 ·
`motion/react` · Web Audio API (synthesized SFX, no assets).
All state is client-side; progress, stats and settings live in `localStorage`.

## Develop

```bash
npm install
npm run dev     # http://localhost:3000
npm run build   # production build
npm run lint
```

## Project layout

| Path | What |
| --- | --- |
| `src/data/topicsManifest.ts` | The topics' metadata (labels, unit, difficulty, target) — the only topic data bundled |
| `public/data/topics/<id>.json` | Topic items, fetched on demand (written by the fetch scripts, most famous first) |
| `public/data/schedule.json` | Daily Rewind schedule `{ "YYYY-MM-DD": "topic-id" }`; unlisted dates rotate through all topics |
| `src/data/loadTopic.ts` | Lazy topic/schedule loader + `useTopic` hook |
| `src/lib/gameEngine.ts` | Pure game rules (reducer) |
| `src/hooks/useGameState.ts` | Engine + guess resolver + live scoring |
| `src/utils/guessMatch.ts` | Blind-input resolver: exact name, alias / typo "Did you mean?" (trigram index + edit distance) |
| `scripts/` | Data fetchers (`run-all.mjs`, `fetch-<topic>.mjs`, `lib/famous-topic.mjs`, `lib/common.mjs`; `audit-data.mjs` checks all data) |
| `src/utils/` | Scoring, time formatting, spin physics, sound engine, daily seed, share card, stats |
| `src/components/` | Earth, year counter, search, summary, modals, mode switching |

### Topic data

```bash
npm run fetch-all                              # every topic in parallel (keyless by default)
npm run fetch-all -- movies anime              # just some
npm run fetch-all -- --limit=2000 --budget=120 # smaller cap / shorter time budget
```

- Quality over volume: broad topics (movies, TV, games, music, books, anime) keep ~2,000
  items and niche ones (cars) ~500 (`--limit` overrides
  both). Items are picked **per decade** by an all-time fame metric (sitelinks, TMDB
  `vote_count`, RAWG `added`, MAL members / AniList popularity, Open Library editions), each
  era getting a weighted share of the cap, so classics are never crowded out by recent
  releases. Each item stores that metric as `fameScore`.
- Each request times out after 15 s and
  each topic has a time budget (`--budget`, seconds); a topic that fails or runs over is
  skipped and keeps its previous file. Progress is logged live per topic.
- Wikidata is queried through [QLever](https://qlever.cs.uni-freiburg.de) (a fast engine over
  a copy of Wikidata) for whole-set queries, falling back to the Wikidata Query Service if it's
  down; `--wdqs` forces the Wikidata Query Service. The full 20,000-game fetch takes ~1 minute.
- Sources: Wikidata (+ Wikipedia infoboxes for dates), AniList/Jikan, Open Library,
  MusicBrainz; TMDB / RAWG when `TMDB_API_KEY` / `RAWG_API_KEY` are set in `.env.local`.
  Set `FETCH_CONTACT` there too — Wikimedia and MusicBrainz throttle anonymous scripts.
- Wikipedia lead sections are cached in `scripts/.cache/` (git-ignored); if Wikipedia rate
  limits a run, re-running later reuses everything already fetched.
- Fame = number of Wikipedia language editions (or the source's popularity). Files list
  items most famous first. Aliases are generated: abbreviations (GTA, NFS, COD, …),
  "Hitman 2: Silent Assassin" → "Hitman 2" / "Hitman Silent Assassin" / "Silent Assassin",
  roman ↔ arabic numerals. An alias never shadows another item's real name; one shared by
  two items goes to the clearly more famous one (≥2× fame) or is dropped. In the game, near-tie
  typo matches also go to the more famous item.
- **Movies** (`npm run fetch:movies`, `npm run verify:movies`) use the shared pipeline in
  `scripts/lib/famous-topic.mjs`: every film on ≥ 15 Wikipedias is kept (~14,200 — Wikidata has
  ~37,000 films on ≥ 8, too many to keep all), topped up to 20,000 per decade; TV series,
  episodes, film series and non-famous short films are dropped.
- **Relay topics** (51 topics used only by Unlimited → Random): `node scripts/fetch-relay-topics.mjs`
  (`--batch N`, `--topic a,b`, `--list`) runs each through the same pipeline: Wikidata classes
  (incl. "subclass of" for product models like the PS5), a guaranteed famous tier, plus the
  hand-written lists in `scripts/overrides/relay/<id>.json` (`add: [[name, year, maker?,
  aliases?]]`; the only source for brand topics Wikidata barely covers). Output:
  `public/data/topics/relay/<id>.json` and counts in `src/data/relayTopics.json`. Coverage:
  `node scripts/verify-relay.mjs` (checklists in `scripts/checklists/relay/`).
- **Anime** (`npm run fetch:anime`, `npm run verify:anime`) merges two sources: Wikidata (anime
  on ≥ 2 Wikipedias, ~2,800 — too few alone) and AniList (every Japanese, non-adult TV/movie/
  OVA/ONA with ≥ 150 users, fetched year by year). Always kept: ≥ 5 Wikipedias or ≥ 40,000
  AniList users; the rest is filled per decade toward 20,000. AniList's romaji/English titles
  become aliases. AniList allows ~30 requests/min, so a run takes ~10–15 min (the job's own
  budget is 30 min).
- **Songs** (`npm run fetch:songs`, `npm run verify:songs`): every song/single on ≥ 8
  Wikipedias is kept (~9,100; ~23,000 are on ≥ 5), topped up to 20,000 per decade. Most famous
  songs are typed "musical work/composition" on Wikidata, so compositions and audio tracks are
  included when their form is a song (or they have a performer) and classical forms, anthems,
  albums and EPs are dropped. In game: Album = series lock, Artist = 3-strike cap.
- **TV shows** (`npm run fetch:tv`, `npm run verify:tv`) use the same pipeline: every series,
  miniseries, animated series or TV programme on ≥ 5 Wikipedias is kept (~14,000), topped up to
  20,000 per decade; TV films, seasons, episodes, franchises, award ceremonies and contest
  events are dropped. Hand fixes: `scripts/overrides/tv-shows.json`.
- **Books** work the same way (`npm run fetch:books`, `npm run verify:books`): every book-like
  work (novels, non-fiction, plays, epics, graphic novels) on ≥ 5 Wikipedias is kept, topped
  up to 20,000 per era from antiquity on; single poems, short stories, essays, letters and
  series entries are dropped. BCE works show as "725 BCE". Hand fixes:
  `scripts/overrides/books.json` (Wikidata has no date for some classics, e.g. the Odyssey).
  Coverage checklists live in `scripts/checklists/<topic>.json` (`verify-topic.mjs <topic>`).
- **Video games** have their own fetcher (`npm run fetch:games`, also run by `fetch-all`):
  every game on ≥ 5 Wikipedias (big and mid titles, ~12,900) is always kept (any year, any
  series), then the topic is topped up to `--limit` games in total (default 20,000) per
  decade from Wikidata and, with `RAWG_API_KEY`, RAWG's all-time most-added. DLC, expansions, soundtracks, mods, bundles and editions are removed
  before any cap. `npm run verify:games` types 50 famous titles into the real blind-input
  resolver and reports what's missing; fix misses in `scripts/overrides/video-games.json`
  (`aliases` for a missed spelling, `_add` for a missing game).

### Adding a topic

1. Add its metadata to `src/data/topicsManifest.ts` (`timeUnit`: `year` \| `bce` \| `mya`,
   `difficulty`, optional `targetYear`, `noun`, `capLabel`, `franchiseLabel`).
2. Add a fetch job (see `scripts/fetch-*.mjs`) that writes `public/data/topics/<id>.json`.
   Years are always "bigger = newer": BCE years are negative, MYA values are stored as
   `-millionsOfYears` (0 = today). Write items most famous first.
3. Optionally schedule it in `public/data/schedule.json`.

Adding a topic changes the fallback Daily rotation for unscheduled dates.

## Deploy

Push to GitHub and import the repo on [Vercel](https://vercel.com/new) — no extra
configuration needed. OpenGraph URLs resolve against Vercel's production domain
automatically; set `NEXT_PUBLIC_SITE_URL` if you use a custom domain.
