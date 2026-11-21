import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { Proposal, SlackHit } from "../core/types.ts";
import { BoardStore, STALE_CLAIM_MS } from "./store.ts";

const ME = "U_ME";
const PROJECTS = ["PROJ"];
const NOW = new Date("2026-11-21T10:00:00Z");
const LATER = (ms: number) => new Date(NOW.getTime() + ms);

const hit = (overrides: Partial<SlackHit>): SlackHit => ({
  channelId: "D01",
  channelLabel: "DM",
  kind: "dm",
  participants: [
    { id: ME, name: "Me" },
    { id: "U_ANA", name: "Ana" },
  ],
  author: { id: "U_ANA", name: "Ana" },
  isBot: false,
  ts: "1795000000.000100",
  threadTs: null,
  permalink: "https://example.slack.com/archives/D01/p1795000000000100",
  text: "Can you look at PROJ-12?",
  ...overrides,
});

const withStores = (body: (first: BoardStore, second: BoardStore) => void) => () => {
  const folder = mkdtempSync(join(tmpdir(), "slack-board-"));
  const path = join(folder, "board.db");
  const first = new BoardStore(path);
  const second = new BoardStore(path);
  try {
    body(first, second);
  } finally {
    first.close();
    second.close();
    rmSync(folder, { recursive: true, force: true });
  }
};

const ingest = (store: BoardStore, hits: SlackHit[], myHits: SlackHit[] = [], now = NOW) =>
  store.ingest({ hits, myHits, me: ME, projectKeys: PROJECTS, syncedAt: now });

const claimedCardKeys = (store: BoardStore): string[] => {
  const claimed = store.claim("worker", NOW);
  assert.ok(claimed);
  return (claimed.input as { cards: { key: string }[] }).cards.map((card) => card.key);
};

test(
  "turns synced messages into cards and asks once for each ticket's details, not its summary",
  withStores((store) => {
    ingest(store, [hit({})]);
    ingest(store, [hit({ ts: "1795000000.000200", text: "PROJ-12 again" })]);

    const [card] = store.cards();
    assert.deepEqual(
      card?.messages.map((message) => message.text),
      ["Can you look at PROJ-12?", "PROJ-12 again"],
    );
    assert.deepEqual(card?.tickets, [
      {
        key: "PROJ-12",
        status: "loading",
        details: null,
        error: null,
        summary: null,
        summaryStatus: "none",
        summaryError: null,
      },
    ]);
    const request = store.claim("worker", NOW);
    assert.deepEqual(
      { kind: request?.kind, input: request?.input },
      { kind: "details", input: { issueKey: "PROJ-12" } },
    );
    assert.equal(store.claim("worker", NOW), null);
  }),
);

test(
  "shows ticket details once fetched and makes a summary only when asked",
  withStores((store) => {
    const details = {
      title: "Old guide after publish",
      status: "In Progress",
      statusCategory: "indeterminate" as const,
      assignee: "Ana",
      priority: "High",
      type: "Bug",
      updated: "2026-11-13T10:28:56.777Z",
      url: "https://example.atlassian.net/browse/PROJ-12",
    };
    ingest(store, [hit({})]);
    store.finish(store.claim("worker", NOW)?.id ?? 0, { ok: true, details }, NOW);
    assert.deepEqual(store.cards()[0]?.tickets[0], {
      key: "PROJ-12",
      status: "ready",
      details,
      error: null,
      summary: null,
      summaryStatus: "none",
      summaryError: null,
    });

    assert.equal(store.summarize("PROJ-12", NOW), true);
    assert.equal(store.cards()[0]?.tickets[0]?.summaryStatus, "loading");
    const request = store.claim("worker", NOW);
    assert.equal(request?.kind, "summarize");
    store.finish(request?.id ?? 0, { ok: true, summary: "In review, fix on dev." }, NOW);

    assert.deepEqual(store.cards()[0]?.tickets[0], {
      key: "PROJ-12",
      status: "ready",
      details,
      error: null,
      summary: "In review, fix on dev.",
      summaryStatus: "ready",
      summaryError: null,
    });
  }),
);

test(
  "hands out my own requests before background ticket details",
  withStores((store) => {
    ingest(store, [hit({})]);
    store.request("propose", "D01", { text: "ok" }, NOW);

    assert.equal(store.claim("worker", NOW)?.kind, "propose");
    assert.equal(store.claim("worker", NOW)?.kind, "details");
  }),
);

test(
  "dates and orders cards by their latest message, not by the sync",
  withStores((store) => {
    ingest(
      store,
      [
        hit({ ts: "1795000000.000100", text: "older" }),
        hit({ channelId: "D02", ts: "1795000500.000000", text: "newer" }),
      ],
      [],
      LATER(3_600_000),
    );

    assert.deepEqual(
      store.cards().map((card) => ({ text: card.messages[0]?.text, updatedAt: card.updatedAt })),
      [
        { text: "newer", updatedAt: new Date(1795000500 * 1000).toISOString() },
        { text: "older", updatedAt: new Date(1795000000 * 1000 + 0.1).toISOString() },
      ],
    );
  }),
);

test(
  "keeps the people and channels from synced messages and from searches, and finds them by name",
  withStores((store) => {
    ingest(store, [
      hit({}),
      hit({
        author: { id: "U_BOB", name: "Bob Kral" },
        channelId: "C01",
        channelLabel: "#backend",
        kind: "channel",
        participants: [],
      }),
    ]);
    store.request("lookup", null, { query: "ann" }, NOW);
    store.finish(
      store.claim("worker", NOW)?.id ?? 0,
      { ok: true, results: [{ channelId: "U_ANN", label: "Anna Berg", kind: "person" }] },
      LATER(1000),
    );

    assert.deepEqual(
      store.searchPeople("an").map((person) => person.label),
      ["Anna Berg", "Ana"],
    );
    assert.deepEqual(store.searchPeople("#back"), [
      { channelId: "C01", label: "#backend", kind: "channel" },
    ]);
    assert.equal(store.searchPeople("").length, 4);
  }),
);

test(
  "asks Claude to rank new cards in batches of 20 and keeps a rank until new messages arrive",
  withStores((store) => {
    const hits = Array.from({ length: 21 }, (_, index) =>
      hit({ channelId: `D${String(index).padStart(2, "0")}`, text: `no ticket ${index}` }),
    );
    ingest(store, hits);

    assert.equal(store.requestRanking(NOW), 2);
    assert.equal(store.requestRanking(NOW), 0);
    const first = store.claim("worker", NOW);
    assert.ok(first);
    const batch = (first.input as { cards: { key: string; ts: string; messages: unknown[] }[] })
      .cards;
    assert.equal(first.kind, "classify");
    assert.equal(batch.length, 20);
    assert.deepEqual(batch[0]?.messages, [{ authorName: "Ana", text: "no ticket 0" }]);
    store.finish(
      first.id,
      { ok: true, priorities: [{ key: "D00", priority: "decision", reason: "Needs your call" }] },
      NOW,
    );

    const ranked = store.cards().find((card) => card.key === "D00");
    assert.deepEqual(
      { priority: ranked?.priority, reason: ranked?.priorityReason },
      { priority: "decision", reason: "Needs your call" },
    );
    assert.equal(store.cards().find((card) => card.key === "D01")?.priority, null);
    store.finish(store.claim("worker", NOW)?.id ?? 0, { ok: true, priorities: [] }, NOW);
    assert.equal(store.requestRanking(NOW), 0);

    ingest(store, [hit({ channelId: "D00", ts: "1795000009.000000", text: "one more thing" })]);
    assert.equal(store.requestRanking(NOW), 1);
    assert.deepEqual(claimedCardKeys(store), ["D00"]);
  }),
);

test("asks again once about cards an earlier version sent for ranking but got no rank for", () => {
  const folder = mkdtempSync(join(tmpdir(), "slack-board-rerank-"));
  const path = join(folder, "board.db");
  const first = new BoardStore(path);
  ingest(first, [hit({ text: "no ticket" }), hit({ channelId: "D02", text: "no ticket either" })]);
  first.requestRanking(NOW);
  first.finish(
    first.claim("worker", NOW)?.id ?? 0,
    { ok: true, priorities: [{ key: "D02", priority: "info", reason: "News" }] },
    NOW,
  );
  first.close();
  const old = new DatabaseSync(path);
  old.exec("PRAGMA user_version = 3");
  old.close();
  const store = new BoardStore(path);
  try {
    assert.equal(store.requestRanking(NOW), 1);
    assert.deepEqual(claimedCardKeys(store), ["D01"]);
  } finally {
    store.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

test("upgrades a database from the first version and fetches details for its tickets again", () => {
  const folder = mkdtempSync(join(tmpdir(), "slack-board-upgrade-"));
  const path = join(folder, "board.db");
  const old = new DatabaseSync(path);
  old.exec(`CREATE TABLE cards (key TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, channel_id TEXT NOT NULL, thread_ts TEXT, messages TEXT NOT NULL, ticket_keys TEXT NOT NULL, proposal TEXT, error TEXT, updated_at TEXT NOT NULL);
    CREATE TABLE tickets (key TEXT PRIMARY KEY, status TEXT NOT NULL, summary TEXT, error TEXT, updated_at TEXT NOT NULL);
    CREATE TABLE requests (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, card_key TEXT, input TEXT NOT NULL, status TEXT NOT NULL, claimed_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    INSERT INTO cards VALUES ('D01', 'dm', 'Ana', 'D01', NULL, '[{"ts":"1795000000.000100","authorName":"Ana","text":"PROJ-12?","permalink":"https://example.slack.com/x"}]', '["PROJ-12"]', NULL, NULL, '2026-11-21T10:00:00.000Z');
    INSERT INTO tickets VALUES ('PROJ-12', 'ready', 'An old automatic summary', NULL, '2026-11-21T10:00:00.000Z');
    INSERT INTO requests (kind, card_key, input, status, created_at, updated_at) VALUES ('summarize', NULL, '{"issueKey":"PROJ-77"}', 'pending', '2026-11-21T10:00:00.000Z', '2026-11-21T10:00:00.000Z');`);
  old.close();
  const store = new BoardStore(path);
  try {
    assert.deepEqual(store.cards()[0]?.tickets, [
      {
        key: "PROJ-12",
        status: "loading",
        details: null,
        error: null,
        summary: null,
        summaryStatus: "none",
        summaryError: null,
      },
    ]);
    assert.deepEqual(store.cards()[0]?.messages[0]?.authorId, null);
    assert.deepEqual(
      { priority: store.cards()[0]?.priority, reason: store.cards()[0]?.priorityReason },
      { priority: null, reason: null },
    );
    const request = store.claim("worker", NOW);
    assert.deepEqual(
      { kind: request?.kind, input: request?.input },
      { kind: "details", input: { issueKey: "PROJ-12" } },
    );
    assert.equal(store.claim("worker", NOW), null);
  } finally {
    store.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

test(
  "keeps an ignored conversation away until something new arrives in it",
  withStores((store) => {
    ingest(store, [hit({})]);
    store.ignore("D01", NOW);
    ingest(store, [hit({})]);
    assert.deepEqual(store.cards(), []);

    ingest(store, [hit({}), hit({ ts: "1795000000.000300", text: "new one" })]);
    assert.deepEqual(
      store.cards().map((card) => card.messages.map((message) => message.text)),
      [["new one"]],
    );
  }),
);

test(
  "hands each request to exactly one worker across processes",
  withStores((first, second) => {
    ingest(first, [
      hit({ text: "no ticket" }),
      hit({ channelId: "D02", text: "no ticket either" }),
    ]);
    assert.equal(first.request("propose", "D01", { text: "ok" }, NOW), true);
    assert.equal(first.request("propose", "D02", { text: "ok" }, NOW), true);

    const claims = [first.claim("a", NOW), second.claim("b", NOW), first.claim("a", NOW)];

    assert.notEqual(claims[0]?.id, claims[1]?.id);
    assert.equal(claims[2], null);
  }),
);

test(
  "gives a request whose worker went quiet to another worker only after the stale time",
  withStores((store) => {
    ingest(store, [hit({ text: "no ticket" })]);
    store.request("propose", "D01", { text: "ok" }, NOW);
    const claimed = store.claim("dead", NOW);
    assert.notEqual(claimed, null);

    assert.equal(store.claim("alive", LATER(STALE_CLAIM_MS)), null);
    assert.equal(store.claim("alive", LATER(STALE_CLAIM_MS + 1))?.id, claimed?.id);
  }),
);

test(
  "refuses a second request for a card while one is still open",
  withStores((store) => {
    ingest(store, [hit({ text: "no ticket" })]);

    assert.equal(store.request("propose", "D01", { text: "first" }, NOW), true);
    assert.equal(store.request("propose", "D01", { text: "double click" }, NOW), false);
    assert.deepEqual(store.cards()[0]?.pending, { kind: "propose", status: "pending" });
  }),
);

test(
  "lets one session hold the sync until its lease runs out",
  withStores((first, second) => {
    assert.equal(first.acquireSyncLease("a", NOW, 60_000), true);
    assert.equal(second.acquireSyncLease("b", LATER(59_999), 60_000), false);
    assert.equal(first.acquireSyncLease("a", LATER(59_999), 60_000), true);
    assert.equal(second.acquireSyncLease("b", LATER(59_999 + 60_000), 60_000), true);
  }),
);

test(
  "after a failed run keeps only the steps that did not run, so approving again sends nothing twice",
  withStores((store) => {
    ingest(store, [hit({ text: "no ticket" })]);
    const proposal: Proposal = {
      summary: "Reply and react",
      steps: [
        { type: "slack_reply", text: "Done." },
        { type: "slack_reaction", emoji: "eyes" },
      ],
    };
    store.approve("D01", proposal, NOW);
    const run = store.claim("worker", NOW);

    store.finish(
      run?.id ?? 0,
      {
        ok: false,
        error: "Step 2 failed: invalid_name",
        remaining: {
          summary: "Reply and react",
          steps: [{ type: "slack_reaction", emoji: "eyes" }],
        },
      },
      NOW,
    );

    const [card] = store.cards();
    assert.equal(card?.error, "Step 2 failed: invalid_name");
    assert.deepEqual(card?.proposal?.steps, [{ type: "slack_reaction", emoji: "eyes" }]);
  }),
);

test(
  "removes a card once its approved steps ran, and does not bring it back on the next sync",
  withStores((store) => {
    ingest(store, [hit({ text: "no ticket" })]);
    store.approve(
      "D01",
      { summary: "React", steps: [{ type: "slack_reaction", emoji: "eyes" }] },
      NOW,
    );
    const run = store.claim("worker", NOW);
    assert.deepEqual(run?.input, {
      proposal: { summary: "React", steps: [{ type: "slack_reaction", emoji: "eyes" }] },
    });

    store.finish(run?.id ?? 0, { ok: true }, NOW);
    ingest(store, [hit({ text: "no ticket" })]);

    assert.deepEqual(store.cards(), []);
  }),
);
