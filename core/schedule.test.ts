import assert from "node:assert/strict";
import { test } from "node:test";
import { nextSyncAt, RETRY_AFTER_FAILURE_MS } from "./schedule.ts";

const NOW = 1_000_000;
const FIVE_MINUTES_MS = 300_000;

test("waits the sync interval after a sync and retries soon after a failed one", () => {
  assert.equal(nextSyncAt(NOW, "synced", FIVE_MINUTES_MS), NOW + FIVE_MINUTES_MS);
  assert.equal(nextSyncAt(NOW, "failed", FIVE_MINUTES_MS), NOW + RETRY_AFTER_FAILURE_MS);
  assert.equal(nextSyncAt(NOW, "failed", 10_000), NOW + 10_000);
});
