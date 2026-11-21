#!/usr/bin/env node
/**
 * Data audit for every topic file (main + relay). Read-only; prints a report.
 *
 *   node scripts/audit-data.mjs [--top=15] [topic …]
 *
 * Checks per topic:
 *   structure  ids unique, names present, integer years in range, fameScore order, count/stats match
 *   names      Q-ids, lowercase starts, leftover "(…)" disambiguators, non-Latin, very long, year-in-name
 *   dupes      two items with the same matching key (only one can ever be typed)
 *   aliases    aliases that shadow another item's name, aliases revealing the item's year
 *   meta       share of "Unknown" makers, missing franchise
 *   eras       items per decade/century, empty decades inside the range, future years
 *   playable   items available at/below common round years (Random needs ≥ 8 older items)
 *   top        the most famous items with their years, for eyeballing wrong dates
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOP = Number(process.argv.find((a) => a.startsWith("--top="))?.split("=")[1] ?? 15);
const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));

const emitWarning = process.emitWarning;
process.emitWarning = (w, ...rest) => (/Module type of .* is not specified/.test(String(w?.message ?? w)) ? undefined : emitWarning.call(process, w, ...rest));
const { normalizeGuess } = await import("../src/utils/guessMatch.ts");
process.emitWarning = emitWarning;

const stats = JSON.parse(await readFile(path.join(ROOT, "src/data/topicStats.json"), "utf8"));
const relayIndex = JSON.parse(await readFile(path.join(ROOT, "src/data/relayTopics.json"), "utf8"));
const relayStats = Object.fromEntries(relayIndex.topics.map((t) => [t.id, t]));

const files = [
  ...(await readdir(path.join(ROOT, "public/data/topics"))).filter((f) => f.endsWith(".json")).map((f) => ({ id: f.replace(".json", ""), file: `public/data/topics/${f}`, relay: false })),
  ...(await readdir(path.join(ROOT, "public/data/topics/relay"))).filter((f) => f.endsWith(".json")).map((f) => ({ id: f.replace(".json", ""), file: `public/data/topics/relay/${f}`, relay: true })),
].filter((t) => !only.length || only.includes(t.id));

const isLatin = (s) => /^[\x20-\x7eÀ-ɏ‘’“”–—]+$/.test(s);
const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : "0%");
const summary = [];

for (const t of files) {
  const data = JSON.parse(await readFile(path.join(ROOT, t.file), "utf8"));
  const items = data.items ?? [];
  const issues = [];
  const warn = (msg) => issues.push(msg);
  const N = items.length;

  // structure
  const ids = new Set();
  let dupIds = 0, badYear = 0, future = 0, noName = 0, orderBreaks = 0;
  for (const [i, it] of items.entries()) {
    if (ids.has(it.id)) dupIds++;
    ids.add(it.id);
    if (!it.name) noName++;
    if (!Number.isInteger(it.year) && !(t.id === "dinosaurs")) badYear++;
    if (it.year > 2025) future++;
    if (i && (items[i - 1].fameScore ?? 0) < (it.fameScore ?? 0)) orderBreaks++;
  }
  if (dupIds) warn(`${dupIds} duplicate ids`);
  if (noName) warn(`${noName} items without a name`);
  if (badYear) warn(`${badYear} non-integer years`);
  if (future) warn(`${future} items dated after 2025`);
  if (orderBreaks) warn(`${orderBreaks} places where fameScore isn't descending (file order = fame for niche/seed)`);
  const s = t.relay ? relayStats[t.id] : stats[t.id];
  if (!s) warn(`no stats entry (${t.relay ? "relayTopics.json" : "topicStats.json"}) — the app shows 0 items`);
  else if (s.count !== N) warn(`stats count ${s.count} ≠ file ${N}`);
  if (data.count !== undefined && data.count !== N) warn(`file count field ${data.count} ≠ ${N} items`);

  // names
  const qids = items.filter((i) => /^Q\d+$/.test(i.name));
  const lower = items.filter((i) => /^[a-z]/.test(i.name) && !/^(e|i)[A-Z]/.test(i.name));
  const paren = items.filter((i) => /\((\d{4}|[^)]*\b(film|song|album|video game|novel|TV series|band|company)\b)[^)]*\)$/i.test(i.name));
  const nonLatin = items.filter((i) => !isLatin(i.name));
  const long = items.filter((i) => i.name.length > 70);
  const yearInName = items.filter((i) => new RegExp(`\\b${i.year}\\b`).test(i.name));
  if (qids.length) warn(`${qids.length} names are bare Wikidata ids: ${qids.slice(0, 5).map((i) => i.name).join(", ")}`);
  if (lower.length > 2) warn(`${lower.length} names start lowercase: ${lower.slice(0, 6).map((i) => i.name).join(", ")}`);
  if (paren.length) warn(`${paren.length} names keep a disambiguator: ${paren.slice(0, 4).map((i) => i.name).join(" | ")}`);
  if (nonLatin.length) warn(`${nonLatin.length} non-Latin names: ${nonLatin.slice(0, 4).map((i) => i.name).join(", ")}`);
  if (long.length) warn(`${long.length} names over 70 chars: ${long.slice(0, 2).map((i) => i.name).join(" | ")}`);
  if (yearInName.length > N * 0.02 && yearInName.length > 5) warn(`${yearInName.length} names contain their own year (gives the answer away): ${yearInName.slice(0, 4).map((i) => i.name).join(" | ")}`);

  // dupes by matching key
  const byKey = new Map();
  for (const it of items) {
    const k = normalizeGuess(it.name);
    byKey.set(k, [...(byKey.get(k) ?? []), it]);
  }
  const dupNames = [...byKey.values()].filter((l) => l.length > 1);
  if (dupNames.length) warn(`${dupNames.length} names typed identically (only the first is reachable): ${dupNames.slice(0, 4).map((l) => l.map((i) => `${i.name} ${i.year}`).join(" / ")).join(" | ")}`);

  // aliases
  let shadow = 0, reveal = 0;
  const shadowEx = [];
  for (const it of items) {
    for (const a of it.aliases ?? []) {
      const k = normalizeGuess(a);
      const owner = byKey.get(k)?.[0];
      if (owner && owner !== it) {
        shadow++;
        if (shadowEx.length < 3) shadowEx.push(`"${a}" on ${it.name} = name of ${owner.name}`);
      }
      if ([...String(a).matchAll(/\b(\d{4})\b/g)].some((m) => Math.abs(Number(m[1]) - it.year) <= 2)) reveal++;
    }
  }
  if (shadow) warn(`${shadow} aliases equal another item's name: ${shadowEx.join(" | ")}`);
  if (reveal) warn(`${reveal} aliases reveal the year`);

  // meta
  const unknown = items.filter((i) => !i.company || /^(unknown|independent)$/i.test(i.company)).length;
  if (unknown > N * 0.25) warn(`${pct(unknown, N)} have no real maker/company ("Unknown") — the 3-strike cap is weak`);

  // eras
  const years = items.map((i) => i.year);
  const minY = Math.min(...years);
  const maxY = Math.max(...years);
  const byDecade = new Map();
  for (const y of years) if (y >= 1800) byDecade.set(Math.floor(y / 10) * 10, (byDecade.get(Math.floor(y / 10) * 10) ?? 0) + 1);
  const emptyDecades = [];
  for (let d = Math.max(1900, Math.floor(minY / 10) * 10); d <= 2020; d += 10) if (!byDecade.get(d)) emptyDecades.push(`${d}s`);
  if (emptyDecades.length) warn(`no items in ${emptyDecades.join(", ")}`);

  // playable: older items available at round years
  const at = (y) => years.filter((v) => v <= y).length;
  const play = { 2025: at(2025), 2000: at(2000), 1975: at(1975), 1950: at(1950), 1900: at(1900) };
  if (t.relay && play[1950] < 8) warn(`only ${play[1950]} items from 1950 or earlier — Random can't ask this topic for older eras`);

  const decades = [...byDecade.entries()].sort((a, b) => a[0] - b[0]).filter(([d]) => d >= 1900).map(([d, n]) => `${String(d).slice(2)}s:${n}`).join(" ");
  summary.push({ id: t.id, relay: t.relay, N, minY, maxY, issues: issues.length, play });
  console.log(`\n━━ ${t.relay ? "relay/" : ""}${t.id}  ${N} items  ${minY} → ${maxY}  (${data.source ?? "?"})`);
  console.log(`   by decade: ${decades}`);
  console.log(`   ≤2000: ${play[2000]}  ≤1975: ${play[1975]}  ≤1950: ${play[1950]}  ≤1900: ${play[1900]}`);
  for (const i of issues) console.log(`   ⚠ ${i}`);
  if (TOP) console.log(`   top: ${items.slice(0, TOP).map((i) => `${i.name} (${i.year})`).join(" · ")}`);
}

console.log("\n━━ summary");
for (const s of summary.sort((a, b) => b.issues - a.issues)) {
  console.log(`  ${(s.relay ? "relay/" : "") + s.id}`.padEnd(32) + `${String(s.N).padStart(6)} items  ${String(s.issues).padStart(2)} warnings  ≤1950: ${s.play[1950]}`);
}
