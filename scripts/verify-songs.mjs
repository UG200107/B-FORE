#!/usr/bin/env node
/**
 * Coverage smoke test for songs: 50 famous songs from the 1930s to today, across genres and
 * countries (scripts/checklists/songs.json), typed into the real blind-input resolver.
 *
 *   node scripts/verify-songs.mjs [--file=public/data/topics/songs.json]
 *
 * See verify-topic.mjs for the report format and how to fix failures.
 */
import { verifyTopic } from "./verify-topic.mjs";

await verifyTopic("songs", process.argv.find((a) => a.startsWith("--file="))?.split("=")[1]);
