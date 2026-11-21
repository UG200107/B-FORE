#!/usr/bin/env node
/**
 * Coverage smoke test for TV shows: 50 famous shows from the 1950s to today, US, UK and world
 * TV (scripts/checklists/tv-shows.json), typed into the real blind-input resolver.
 *
 *   node scripts/verify-tv.mjs [--file=public/data/topics/tv-shows.json]
 *
 * See verify-topic.mjs for the report format and how to fix failures.
 */
import { verifyTopic } from "./verify-topic.mjs";

await verifyTopic("tv-shows", process.argv.find((a) => a.startsWith("--file="))?.split("=")[1]);
