# Project: Time Rewind Web Game (Working Title)

A minimalist, dark-mode 2D web game inspired by Krillion.io. Players rewind a 2D Earth through history by guessing older items within a given topic.

## Tech Stack
- Next.js (App Router), React, TypeScript (strict)
- Tailwind CSS (responsive desktop + mobile)
- Fuse.js for client-side fuzzy autocomplete
- `motion/react` for animations
- Web Audio API for synthesized MVP sound effects
- Local JSON files in `/src/data/topics/` for topic datasets

## Core Game Rules
1. **Seed Item:** Every round begins with 1 starting item that sets the current year.
2. **Valid Guess:** Must be older than or equal to the current year.
3. **Paradox (Mistake):** Guessing an item newer than the current year costs 1 life (3 lives total), does not advance the timeline, and triggers an error state.
4. **Franchise Lock:** Once an item's `franchise` is used, all other items with that same `franchise` are locked for the round.
5. **Company Cap (3-Strike Rule):** Players can use a maximum of 3 items from the same `company`. At 3 uses, display 3 crosses on that company and lock all remaining items from it.
6. **Modes:**
   - **Daily Rewind:** Push as far back in time as possible within 10 moves.
   - **Arcade:** Reach a specific target year within a set number of moves.
7. **Efficiency Scoring:** Reward even, well-paced jumps across the topic's timeline (e.g., 5-year jumps across a 50-year span in 10 moves = max efficiency), plus bonuses for remaining lives/moves.
8. **Hint:** 1 "Time Pulse" per round reveals the decade/era of one valid, unused item.

## Data Schema (`/src/data/topics/*.json`)
Every item must strictly follow:
```ts
type TopicItem = {
  id: string;
  name: string;
  year: number; // negative for BCE or scaled for MYA
  franchise: string;
  company: string;
};