#!/usr/bin/env node
/**
 * Coverage smoke test for video games: 50 famous & semi-famous titles from every era and
 * platform (scripts/checklists/video-games.json) typed into the real blind-input resolver.
 *
 *   node scripts/verify-games.mjs [--file=public/data/topics/video-games.json]
 *
 * See verify-topic.mjs for the report format and how to fix failures.
 */
import { verifyTopic } from "./verify-topic.mjs";

await verifyTopic("video-games", process.argv.find((a) => a.startsWith("--file="))?.split("=")[1]);
