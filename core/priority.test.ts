import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_REASON_CHARS, parsePriorities } from "./priority.ts";

const KEYS = ["D01", "C01:1795000000.500000", "D02"];

test("maps the card numbers Claude answers with back to the cards, ignoring numbers and levels it was not given", () => {
  const answer = [
    "Here you go:",
    "```json",
    JSON.stringify([
      { card: 1, priority: "decision", reason: "Asks you to pick the release date" },
      { card: 2, priority: "social", reason: "x".repeat(MAX_REASON_CHARS + 20) },
      { card: 4, priority: "action", reason: "Not on this batch" },
      { card: 3, priority: "urgent", reason: "Not a level" },
      { card: "1", priority: "info", reason: "Not a number" },
    ]),
    "```",
  ].join("\n");

  assert.deepEqual(parsePriorities(answer, KEYS), [
    { key: "D01", priority: "decision", reason: "Asks you to pick the release date" },
    { key: "C01:1795000000.500000", priority: "social", reason: "x".repeat(MAX_REASON_CHARS) },
  ]);
});

test("rejects an answer that holds no list", () => {
  assert.throws(() => parsePriorities("I could not rank these.", KEYS), /no list of priorities/);
});
