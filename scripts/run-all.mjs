#!/usr/bin/env node
/**
 * Fetches every topic in parallel and prints a summary.
 *
 *   npm run fetch-all                       all 10 topics
 *   npm run fetch-all -- cars anime         just these
 *   npm run fetch-all -- --limit=500 --budget=90 --concurrency=3
 *
 * Each topic has its own time budget (--budget, default 45 s) and every request a 15 s
 * timeout. A topic that fails or runs over is skipped and its previous file is kept; it
 * never blocks the others. Per-host limits keep parallel topics polite to each API.
 */
import { loadEnvLocal, printSummary, runJobs } from "./lib/common.mjs";

await loadEnvLocal();
const { jobs: wikidataJobs } = await import("./fetch-wikidata.mjs");
const { jobs: mediaJobs } = await import("./fetch-music.mjs");
const { jobs: gameJobs } = await import("./fetch-games.mjs");
const { jobs: bookJobs } = await import("./fetch-books.mjs");
const { jobs: movieJobs } = await import("./fetch-movies.mjs");
const { jobs: tvJobs } = await import("./fetch-tv.mjs");
const { jobs: songJobs } = await import("./fetch-songs.mjs");
const { jobs: animeJobs } = await import("./fetch-anime.mjs");
const jobs = { ...mediaJobs, ...gameJobs, ...bookJobs, ...movieJobs, ...tvJobs, ...songJobs, ...animeJobs, ...wikidataJobs };

const args = process.argv.slice(2);
const names = args.filter((a) => !a.startsWith("--"));
const concurrency = Number(args.find((a) => a.startsWith("--concurrency="))?.split("=")[1] ?? 5);

const t0 = Date.now();
const results = await runJobs(jobs, names.length ? names : Object.keys(jobs), { concurrency });
printSummary(results);
const ok = Object.values(results).filter((r) => r.ok).length;
console.log(`\n${ok}/${Object.keys(results).length} topics updated in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (ok < Object.keys(results).length) process.exitCode = 1;
