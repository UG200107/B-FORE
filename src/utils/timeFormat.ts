import type { TimeUnit } from "@/types/topic";

/** Up to `digits` decimals, without trailing zeros ("0.5", "66", "1.25"). */
function trim(n: number, digits = 2): string {
  return String(Number(n.toFixed(digits)));
}

/** A timeline position as display text: "2024", "44 BCE" / "1200 CE", "66 MYA". */
export function formatYear(year: number, unit: TimeUnit): string {
  switch (unit) {
    case "year": {
      // Ancient works in year topics (the Odyssey in Books) read as BCE.
      const y = Math.round(year);
      return y < 0 ? `${-y} BCE` : String(y);
    }
    case "bce": {
      const y = Math.round(year);
      return y < 0 ? `${-y} BCE` : `${y} CE`;
    }
    case "mya":
      return year >= 0 ? "0 MYA" : `${trim(-year)} MYA`;
  }
}

/** Rolling-counter variant: integer steps only, so digits don't flicker through decimals. */
export function formatRollingYear(year: number, unit: TimeUnit): string {
  return formatYear(unit === "mya" ? Math.round(year) : year, unit);
}

/** How far a jump went: "4 yrs", "1 yr", "66 MY". */
export function formatJump(jump: number, unit: TimeUnit): string {
  if (unit === "mya") return `${trim(jump)} MY`;
  return `${Math.round(jump)} ${Math.round(jump) === 1 ? "yr" : "yrs"}`;
}

/** Vague era for hints: "the 1990s", "the 40s BCE", "around 150 MYA". */
export function formatEra(year: number, unit: TimeUnit): string {
  switch (unit) {
    case "year":
      if (year < 0) return `the ${Math.floor(-year / 100) * 100}s BCE`;
      if (year < 1500) return `the ${ordinal(Math.floor(year / 100) + 1)} century`;
      return `the ${Math.floor(year / 10) * 10}s`;
    case "bce": {
      if (year < 0) return `the ${Math.floor(-year / 10) * 10}s BCE`;
      return `the ${Math.floor(year / 10) * 10}s CE`;
    }
    case "mya": {
      const mya = -year;
      if (mya < 1) return "the present day";
      if (mya < 20) return `around ${Math.max(5, Math.round(mya / 5) * 5)} MYA`;
      return `around ${Math.round(mya / 10) * 10} MYA`;
    }
  }
}

/** 1 → "1st", 2 → "2nd", 11 → "11th", 23 → "23rd". */
function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}
