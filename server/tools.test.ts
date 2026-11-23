import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { SlackHit } from "../core/types.ts";
import { BoardStore } from "./store.ts";
import { runTool } from "./tools.ts";

const CHANNEL_HIT: SlackHit = {
  channelId: "C01",
  channelLabel: "#backend",
  kind: "channel",
  participants: [],
  author: { id: "U_BOB", name: "Bob" },
  isBot: false,
  ts: "1795000000.000100",
  threadTs: null,
  permalink: "https://example.slack.com/archives/C01/p1795000000000100",
  text: "Deploy is done",
};

const SYNC = {
  hits: [],
  myHits: [],
  channelHits: [CHANNEL_HIT],
  hasMoreChannelHits: true,
  lookbackDays: 7,
  me: "U_ME",
  syncedAt: "2026-11-21T10:00:00.000Z",
};

test("hands a sync's channel messages, whether some are missing, and the lookback to the board", () => {
  const folder = mkdtempSync(join(tmpdir(), "slack-board-tools-"));
  const store = new BoardStore(join(folder, "board.db"));
  const context = { store, projectKeys: [], boardUrl: () => "" };
  try {
    assert.deepEqual(runTool("ingest", { ...SYNC, hasMoreChannelHits: "yes" }, context), {
      text: "hasMoreChannelHits must be true or false",
      isError: true,
    });

    assert.equal(runTool("ingest", SYNC, context).isError, false);
    const { total, isMissing } = store.otherMessages(new Set());
    assert.deepEqual({ total, isMissing }, { total: 1, isMissing: true });
  } finally {
    store.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
