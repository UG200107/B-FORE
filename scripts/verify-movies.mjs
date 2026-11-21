#!/usr/bin/env node
/**
 * Coverage smoke test for movies: 50 famous films from 1896 to today, Hollywood and world
 * cinema (scripts/checklists/movies.json), typed into the real blind-input resolver.
 *
 *   node scripts/verify-movies.mjs [--file=public/data/topics/movies.json]
 *
 * See verify-topic.mjs for the report format and how to fix failures.
 */
import { verifyTopic } from "./verify-topic.mjs";

await verifyTopic("movies", process.argv.find((a) => a.startsWith("--file="))?.split("=")[1]);
