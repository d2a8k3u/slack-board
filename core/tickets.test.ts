import assert from "node:assert/strict";
import { test } from "node:test";
import { ticketKeys } from "./tickets.ts";

test("finds keys of configured projects once each, in plain text, links and any case", () => {
  const text = [
    "Can you check PROJ-4945 and https://example.atlassian.net/browse/PROJ-12?",
    "Also proj-4945 again, UTF-8 and ISO-8601 are not tickets, neither is XPROJ-7 or OTHER-3.",
  ].join("\n");

  assert.deepEqual(ticketKeys(text, ["PROJ"]), ["PROJ-4945", "PROJ-12"]);
});

test("finds nothing when no project is configured", () => {
  assert.deepEqual(ticketKeys("PROJ-1 shipped in build -42", []), []);
});
