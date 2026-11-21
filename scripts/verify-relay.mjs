#!/usr/bin/env node
/**
 * Coverage smoke test for the relay topics (Unlimited → Random): every topic with a checklist in
 * scripts/checklists/relay/<id>.json is typed into the real blind-input resolver against
 * public/data/topics/relay/<id>.json. Prints a per-topic report and a summary; exits 1 on misses.
 *
 *   node scripts/verify-relay.mjs [topic …]
 */
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyTopic } from "./verify-topic.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wanted = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const ids = (await readdir(path.join(ROOT, "scripts/checklists/relay")))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""))
  .filter((id) => !wanted.length || wanted.includes(id));

const summary = [];
for (const id of ids) {
  try {
    const { passed, total } = await verifyTopic(`relay/${id}`);
    summary.push([id, `${passed}/${total}`]);
  } catch (e) {
    summary.push([id, `ERROR ${e.message.split("\n")[0]}`]);
    process.exitCode = 1;
  }
}
console.log("\nrelay coverage:");
for (const [id, s] of summary) console.log(`  ${id.padEnd(24)} ${s}`);
