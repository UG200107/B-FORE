// Logs which year-quiz questions When mode leaves out.
// When uses only the first PER_TOPIC valid questions of each topic: the files are ordered
// easiest first (famous tier, by fame). Mirror of the rule in src/data/loadYearQuiz.ts.
// Usage: node scripts/year-quiz-top.mjs  → writes logs/year-quiz-excluded.md
import fs from "node:fs";

const PER_TOPIC = 30;
const NOW = 2026;
const MIN_YEAR = -12000;
const dir = "public/data/year-quiz";
const { topics } = JSON.parse(fs.readFileSync(`${dir}/manifest.json`, "utf8"));

const fmt = (y) => (y < 0 ? `${-y} BCE` : String(y));
let used = 0;
let skipped = 0;
const out = [
  "# Year-quiz questions not used in When mode",
  "",
  `When mode asks only the ${PER_TOPIC} easiest questions of each topic (the first ${PER_TOPIC} in each file, which are ordered famous-first by fame).`,
  "Everything else is listed here, per topic, so it can be brought back later.",
  `Out-of-range = a year after ${NOW} or before ${fmt(MIN_YEAR)} (the dial can't reach it).`,
  "",
];
for (const t of topics) {
  const items = JSON.parse(fs.readFileSync(`${dir}/${t.id}.json`, "utf8"));
  const valid = items.filter((i) => Number.isFinite(i.year) && i.year <= NOW && i.year >= MIN_YEAR);
  const invalid = items.filter((i) => !valid.includes(i));
  const rest = valid.slice(PER_TOPIC);
  used += Math.min(PER_TOPIC, valid.length);
  skipped += rest.length + invalid.length;
  out.push(`## ${t.name} (\`${t.id}\`): ${Math.min(PER_TOPIC, valid.length)} used, ${rest.length + invalid.length} left out`, "");
  for (const i of invalid) out.push(`- ${i.name} (${fmt(i.year)}, ${i.tier}) **out of range**`);
  for (const i of rest) out.push(`- ${i.name} (${fmt(i.year)}, ${i.tier})`);
  out.push("");
}
out.splice(5, 0, `Used: ${used}. Left out: ${skipped}.`, "");
fs.mkdirSync("logs", { recursive: true });
fs.writeFileSync("logs/year-quiz-excluded.md", out.join("\n"));
console.log(`used ${used}, left out ${skipped} → logs/year-quiz-excluded.md`);
