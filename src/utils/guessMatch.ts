import type { TopicItem } from "@/types/topic";

const ROMAN: Record<string, number> = {
  ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10,
  xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15, xvi: 16,
};

/**
 * Comparison key: case/accent/punctuation-insensitive, "&" = "and", roman numerals → digits
 * ("Pokémon" = "pokemon", "GTA: IV" = "gta 4"). A lone "I" is left alone ("I Am Bread").
 */
export function normalizeGuess(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    // "cod4" = "cod 4", "2k" = "2 k"
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .map((t) => (ROMAN[t] ? String(ROMAN[t]) : t))
    .join(" ");
}

export type GuessMatch =
  /** Typed the item's name: submit right away. */
  | { kind: "exact"; item: TopicItem }
  /** Alias or close typo: ask "Did you mean …?" first. */
  | { kind: "suggest"; item: TopicItem }
  | { kind: "none" };

/** Minimum edit-distance similarity (0–1) for a typo to earn a "Did you mean?". */
const SUGGEST_MIN_SIMILARITY = 0.8;
/** Trigram overlap (Dice coefficient) below which a form can't plausibly reach the bar above. */
const MIN_TRIGRAM_DICE = 0.3;
/** How many best trigram candidates get the (exact, slower) edit-distance check. */
const RERANK = 40;
/**
 * Typo matches within this much similarity of the best one count as a tie, and the most
 * famous item wins, so a famous title beats an obscure DLC, mod or remaster spelled alike.
 */
const FAME_TIE = 0.05;

/**
 * Edit distance where swapping two neighbouring letters counts as one edit (optimal string
 * alignment), so "Wonder oWman" is closer to "Wonder Woman" than to "Wonder Man".
 */
function editDistance(a: string, b: string): number {
  const n = b.length;
  let prev2 = new Array<number>(n + 1).fill(0);
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let cur = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2] + 1);
      cur[j] = d;
    }
    [prev2, prev, cur] = [prev, cur, prev2];
  }
  return prev[n];
}

function similarity(a: string, b: string): number {
  const len = Math.max(a.length, b.length);
  return len === 0 ? 1 : 1 - editDistance(a, b) / len;
}

const numbers = (s: string) => s.split(" ").filter((t) => /^\d+$/.test(t)).join(" ");

/** Normalized text only contains " ", a–z and 0–9: 37 symbols, so a trigram fits in an int. */
const SYMBOLS = 37;
const TRIGRAM_SPACE = SYMBOLS ** 3;
function symbol(code: number): number {
  if (code >= 97 && code <= 122) return code - 96; // a–z → 1–26
  if (code >= 48 && code <= 57) return code - 21; // 0–9 → 27–36
  return 0; // space
}

/** Distinct 3-letter fragments of " text " as integer codes (padding counts word starts/ends). */
function trigrams(s: string): Set<number> {
  const out = new Set<number>();
  const len = s.length + 2;
  const at = (i: number) => (i === 0 || i === len - 1 ? 0 : symbol(s.charCodeAt(i - 1)));
  for (let i = 0; i + 3 <= len; i++) out.add((at(i) * SYMBOLS + at(i + 1)) * SYMBOLS + at(i + 2));
  return out;
}

/** One searchable spelling of an item: its name, name without "The", or an alias. */
type Form = { text: string; item: TopicItem; nums: string; gramCount: number };

/**
 * Builds a resolver for one topic's items.
 *
 * Exact names and aliases are hash lookups. Typos use a trigram index built once here: a
 * query only visits forms sharing 3-letter fragments with it, keeps those with enough overlap
 * and a compatible length, and runs edit distance on the best few. That gives the same answers
 * as a full fuzzy scan at a fraction of the cost on 15,000-item topics.
 */
export function createMatcher(items: TopicItem[]): (query: string) => GuessMatch {
  const byName = new Map<string, TopicItem>();
  const byAlias = new Map<string, TopicItem>();
  /** Every searchable spelling per item, gathered now; indexed only when a typo needs it. */
  const spellingsOf: { item: TopicItem; spellings: Set<string> }[] = [];

  // Fame: the source's fameScore, else file position (files list the most famous first).
  const fame = new Map<TopicItem, number>(items.map((it, i) => [it, it.fameScore ?? items.length - i]));
  const famous = (a: TopicItem, b: TopicItem | undefined) => !b || fame.get(a)! > fame.get(b)!;

  for (const item of items) {
    const name = normalizeGuess(item.name);
    if (!name) continue;
    const aliases = (item.aliases ?? []).map(normalizeGuess).filter(Boolean);
    // Same spelling on two items (remake vs original, game vs DLC): the more famous wins.
    if (famous(item, byName.get(name))) byName.set(name, item);
    for (const a of aliases) if (famous(item, byAlias.get(a))) byAlias.set(a, item);
    const spellings = new Set([name, ...aliases]);
    // "The Legend of Zelda" also matches "Legend of Zelda".
    if (name.startsWith("the ")) {
      const bare = name.slice(4);
      if (famous(item, byAlias.get(bare))) byAlias.set(bare, item);
      spellings.add(bare);
    }
    spellingsOf.push({ item, spellings });
  }

  // Trigram index, built lazily on the first typo so loading a topic stays fast (exact names
  // and aliases never need it).
  const forms: Form[] = [];
  let postings: (number[] | undefined)[] | null = null;
  let shared = new Uint16Array(0);
  const touched: number[] = [];
  const ensureIndex = () => {
    if (postings) return postings;
    // Flat array indexed by trigram code → indices of forms containing it.
    const index: (number[] | undefined)[] = new Array(TRIGRAM_SPACE);
    for (const { item, spellings } of spellingsOf) {
      for (const text of spellings) {
        const grams = trigrams(text);
        const idx = forms.length;
        forms.push({ text, item, nums: numbers(text), gramCount: grams.size });
        for (const g of grams) (index[g] ??= []).push(idx);
      }
    }
    shared = new Uint16Array(forms.length); // scratch counts, reset after each query
    postings = index;
    return index;
  };

  return (query: string): GuessMatch => {
    const q = normalizeGuess(query);
    if (!q) return { kind: "none" };

    const exact = byName.get(q);
    if (exact) return { kind: "exact", item: exact };

    const alias = byAlias.get(q);
    if (alias) return { kind: "suggest", item: alias };

    // "The Odyssey" for an item named "Odyssey": a leading "the" is just style.
    if (q.startsWith("the ")) {
      const bare = byName.get(q.slice(4));
      if (bare) return { kind: "exact", item: bare };
    }

    // Fuzzy: never for 1–3 char guesses, and numbers must match exactly
    // ("FIFA 98" must not become "FIFA 09").
    if (q.length < 4) return { kind: "none" };
    const qNums = numbers(q);
    const qGrams = trigrams(q);
    const index = ensureIndex();

    // Count shared trigrams per form, touching only forms that share at least one.
    for (const g of qGrams) {
      const list = index[g];
      if (!list) continue;
      for (const idx of list) {
        if (shared[idx] === 0) touched.push(idx);
        shared[idx]++;
      }
    }

    const candidates: { idx: number; dice: number }[] = [];
    for (const idx of touched) {
      const count = shared[idx];
      shared[idx] = 0;
      const f = forms[idx];
      const dice = (2 * count) / (qGrams.size + f.gramCount);
      if (dice < MIN_TRIGRAM_DICE) continue;
      // Similarity ≥ 0.8 is impossible if lengths differ by more than 20%.
      const longer = Math.max(q.length, f.text.length);
      if (Math.abs(q.length - f.text.length) > longer * (1 - SUGGEST_MIN_SIMILARITY)) continue;
      if (f.nums !== qNums) continue;
      candidates.push({ idx, dice });
    }
    touched.length = 0;

    candidates.sort((a, b) => b.dice - a.dice);
    const scored = candidates.slice(0, RERANK).map(({ idx }) => ({ item: forms[idx].item, sim: similarity(q, forms[idx].text) }));
    const top = Math.max(0, ...scored.map((c) => c.sim));
    if (top < SUGGEST_MIN_SIMILARITY) return { kind: "none" };
    // Among near-equal matches, prefer the most famous item.
    let best: TopicItem | null = null;
    for (const c of scored) {
      if (c.sim >= SUGGEST_MIN_SIMILARITY && c.sim >= top - FAME_TIE && famous(c.item, best ?? undefined)) best = c.item;
    }
    return best ? { kind: "suggest", item: best } : { kind: "none" };
  };
}
