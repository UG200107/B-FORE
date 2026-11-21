#!/usr/bin/env node
/**
 * Coverage smoke test for books: 50 famous & semi-famous books from antiquity to today
 * (scripts/checklists/books.json) typed into the real blind-input resolver.
 *
 *   node scripts/verify-books.mjs [--file=public/data/topics/books.json]
 *
 * See verify-topic.mjs for the report format and how to fix failures.
 */
import { verifyTopic } from "./verify-topic.mjs";

await verifyTopic("books", process.argv.find((a) => a.startsWith("--file="))?.split("=")[1]);
