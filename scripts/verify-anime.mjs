#!/usr/bin/env node
/**
 * Coverage smoke test for anime: 50 famous anime from the 1960s to today, including romaji
 * titles (scripts/checklists/anime.json), typed into the real blind-input resolver.
 *
 *   node scripts/verify-anime.mjs [--file=public/data/topics/anime.json]
 *
 * See verify-topic.mjs for the report format and how to fix failures.
 */
import { verifyTopic } from "./verify-topic.mjs";

await verifyTopic("anime", process.argv.find((a) => a.startsWith("--file="))?.split("=")[1]);
