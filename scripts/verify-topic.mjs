#!/usr/bin/env node
/**
 * Coverage smoke test for a topic.
 *
 *   node scripts/verify-topic.mjs <topic> [--file=public/data/topics/<topic>.json]
 *   node scripts/verify-games.mjs   ·   node scripts/verify-books.mjs
 *
 * Types each title from scripts/checklists/<topic>.json into the game's real blind-input
 * resolver (src/utils/guessMatch.ts, loaded directly by Node ≥ 23.6) and checks it resolves to
 * the right item, as a direct hit or a "Did you mean?". Prints a pass/fail report, writes the
 * failures to scripts/.cache/verify-<topic>.json with a suggested fix for each, and exits 1 if
 * anything failed.
 *
 * Checklist entries: { "type": what a player types, "expect"?: the item's name (default: same
 * as typed), "startsWith"?: accept longer official names }.
 *
 * Fix a failure by re-checking the fetch query, or in scripts/overrides/<topic>.json:
 *   - in the file but not matched → add the typed form to that item's "aliases"
 *   - not in the file at all       → add it to "_add" (name, year, franchise, company)
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Node notes that the .ts file has no "type": "module" package; that's expected here.
const emitWarning = process.emitWarning;
process.emitWarning = (w, ...rest) =>
  /Module type of .* is not specified/.test(String(w?.message ?? w)) ? undefined : emitWarning.call(process, w, ...rest);
const { createMatcher, normalizeGuess } = await import("../src/utils/guessMatch.ts");
process.emitWarning = emitWarning;

export async function verifyTopic(topic, fileArg) {
  const FILE = path.resolve(ROOT, fileArg ?? `public/data/topics/${topic}.json`);
  const REPORT = path.join(ROOT, `scripts/.cache/verify-${topic}.json`);
  const CHECKLIST = JSON.parse(await readFile(path.join(ROOT, `scripts/checklists/${topic}.json`), "utf8")).filter(
    (c) => typeof c === "object" && c.type,
  );

  const file = JSON.parse(await readFile(FILE, "utf8"));
  const items = file.items;
  const resolve = createMatcher(items);
  const key = (s) => normalizeGuess(s);

  /** Does `item` count as the expected one? */
  const isExpected = (item, check) => {
    const want = key(check.expect ?? check.type);
    const got = key(item.name);
    return got === want || (check.startsWith && got.startsWith(want));
  };

  const results = CHECKLIST.map((check) => {
    const m = resolve(check.type);
    const item = m.kind === "none" ? null : m.item;
    if (item && isExpected(item, check)) return { ...check, ok: true, how: m.kind === "exact" ? "exact" : "did-you-mean", item };
    const inFile = items.find((it) => isExpected(it, check)) ?? null;
    return {
      ...check,
      ok: false,
      got: item ? `${item.name} (${item.year})` : "nothing",
      inFile,
      fix: inFile
        ? { [inFile.id]: { aliases: [check.type] } }
        : { _add: [{ name: check.expect ?? check.type, year: null, franchise: null, company: null }] },
    };
  });

  const passed = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);

  console.log(`\n${topic} coverage — ${path.relative(ROOT, FILE)} (${items.length} items, ${file.source ?? "?"})\n`);
  for (const r of results) {
    if (r.ok) {
      console.log(`  ✓ ${r.type.padEnd(42)} ${r.how === "exact" ? "" : "(did you mean) "}${r.item.name} (${r.item.year})`);
    } else {
      const why = r.inFile ? `in file as "${r.inFile.name}" but typing it gives ${r.got}` : `NOT IN FILE (typing it gives ${r.got})`;
      console.log(`  ✗ ${r.type.padEnd(42)} ${why}`);
    }
  }
  console.log(`\n${passed.length}/${results.length} passed${failed.length ? ` — Missing: [${failed.map((r) => r.type).join(", ")}]` : ""}`);

  await mkdir(path.dirname(REPORT), { recursive: true });
  await writeFile(
    REPORT,
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        file: path.relative(ROOT, FILE),
        passed: passed.length,
        total: results.length,
        failures: failed.map((r) => ({ type: r.type, expect: r.expect ?? r.type, got: r.got, inFile: r.inFile?.id ?? null, fix: r.fix })),
      },
      null,
      2,
    ) + "\n",
  );

  if (failed.length) {
    console.log(`\nFailures logged to ${path.relative(ROOT, REPORT)}. Suggested fixes for scripts/overrides/${topic}.json:`);
    for (const r of failed) {
      console.log(
        r.inFile
          ? `  alias  "${r.inFile.id}": { "aliases": ["${r.type}"] }`
          : `  _add   { "name": "${r.expect ?? r.type}", "year": ?, "franchise": ?, "company": ? }  — or check why the fetch missed it`,
      );
    }
    process.exitCode = 1;
  }
  return { passed: passed.length, total: results.length };
}

if (process.argv[1]?.endsWith("verify-topic.mjs")) {
  const topic = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!topic) {
    console.log("usage: node scripts/verify-topic.mjs <topic> [--file=…]");
    process.exit(2);
  }
  await verifyTopic(topic, process.argv.find((a) => a.startsWith("--file="))?.split("=")[1]);
}
