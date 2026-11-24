import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { Proposal, SlackHit } from "../core/types.ts";
import { ACT_STALE_MS, BoardStore, STALE_CLAIM_MS } from "./store.ts";

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

const LOOKBACK_DAYS = 7;
const DAY_MS = 24 * 60 * 60_000;

const channelHit = (overrides: Partial<SlackHit>): SlackHit =>
  hit({
    channelId: "C01",
    channelLabel: "#backend",
    kind: "channel",
    participants: [],
    author: { id: "U_BOB", name: "Bob" },
    text: "Deploy is done",
    ...overrides,
  });

const ingestChannels = (
  store: BoardStore,
  channelHits: SlackHit[],
  {
    hits = [],
    myHits = [],
    hasMore = false,
    now = NOW,
  }: { hits?: SlackHit[]; myHits?: SlackHit[]; hasMore?: boolean; now?: Date } = {},
) =>
  store.ingest({
    hits,
    myHits,
    channelHits,
    hasMoreChannelHits: hasMore,
    me: ME,
    projectKeys: PROJECTS,
    syncedAt: now,
    lookbackDays: LOOKBACK_DAYS,
  });

const ingest = (store: BoardStore, hits: SlackHit[], myHits: SlackHit[] = [], now = NOW) =>
  ingestChannels(store, [], { hits, myHits, now });

const NO_CHANNEL_OPEN = new Set<string>();

const otherTexts = (store: BoardStore, channelId = "C01"): string[] =>
  store
    .otherMessages(new Set([channelId]))
    .channels.find((channel) => channel.channelId === channelId)
    ?.messages?.map((message) => message.text) ?? [];

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
  "tells which messages a sync brought, but none on the first sync that fills the board",
  withStores((store) => {
    assert.deepEqual(ingest(store, [hit({})]), []);

    const news = ingest(
      store,
      [hit({}), hit({ ts: "1795000000.000200", text: "And PROJ-13?" })],
      [],
      LATER(60_000),
    );

    assert.deepEqual(
      news.map((entry) => [entry.cardKey, entry.message.text]),
      [["D01", "And PROJ-13?"]],
    );
  }),
);

test(
  "keeps the latest new messages for the board page until a later sync brings newer ones",
  withStores((store) => {
    assert.equal(store.latestNews(), null);
    ingest(store, [hit({})]);
    assert.equal(store.latestNews(), null);

    const later = hit({ ts: "1795000000.000200", text: "And PROJ-13?" });
    ingest(store, [hit({}), later], [], LATER(60_000));
    ingest(store, [hit({}), later], [], LATER(120_000));

    assert.deepEqual(
      {
        at: store.latestNews()?.at,
        texts: store.latestNews()?.items.map((entry) => entry.message.text),
      },
      { at: LATER(60_000).toISOString(), texts: ["And PROJ-13?"] },
    );
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
    assert.deepEqual(
      store.searchPeople("", "channel").map((person) => person.label),
      ["#backend"],
    );
    assert.deepEqual(
      store.searchPeople("b", "person").map((person) => person.label),
      ["Anna Berg", "Bob Kral"],
    );
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

test("upgrades a database from version 4 so Actions can keep its waiting steps", () => {
  const folder = mkdtempSync(join(tmpdir(), "slack-board-upgrade-v4-"));
  const path = join(folder, "board.db");
  const first = new BoardStore(path);
  ingest(first, [hit({ text: "no ticket" })]);
  first.close();
  const old = new DatabaseSync(path);
  old.exec("ALTER TABLE card_context DROP COLUMN action_proposal; PRAGMA user_version = 4");
  old.close();
  const store = new BoardStore(path);
  try {
    answerPrompt(store, "Comment on the ticket", COMMENT);
    assert.deepEqual(store.cards()[0]?.actionProposal?.proposal, COMMENT);
  } finally {
    store.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

test("upgrades a database from version 5 so a failed draft can be tried again", () => {
  const folder = mkdtempSync(join(tmpdir(), "slack-board-upgrade-v5-"));
  const path = join(folder, "board.db");
  const first = new BoardStore(path);
  ingest(first, [hit({ text: "no ticket" })]);
  first.close();
  const old = new DatabaseSync(path);
  old.exec("ALTER TABLE cards DROP COLUMN retry_request; PRAGMA user_version = 5");
  old.close();
  const store = new BoardStore(path);
  try {
    failDraft(store, { text: "say it is done" });
    assert.equal(store.retry("D01", NOW), true);
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
  "brings a new reply in a thread I was only mentioned in, also after I handled its card",
  withStores((store) => {
    const mention = channelHit({ ts: "1795000100.000000", text: `<@${ME}> can you check?` });
    const reply = channelHit({
      ts: "1795000200.000000",
      threadTs: "1795000100.000000",
      author: { id: "U_ANA", name: "Ana" },
      text: "Any news?",
    });
    ingestChannels(store, [mention], { hits: [mention] });
    store.ignore("C01:1795000100.000000", NOW);

    ingestChannels(store, [reply], { now: LATER(60_000) });

    assert.deepEqual(
      store.cards().map((card) => ({ key: card.key, texts: card.messages.map((m) => m.text) })),
      [{ key: "C01:1795000100.000000", texts: ["Any news?"] }],
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
  "reports a requested sync as running from the request until Claude Code finishes it",
  withStores((store) => {
    assert.equal(store.syncState().isRunning, false);

    store.request("sync", null, {}, NOW);
    assert.equal(store.syncState().isRunning, true);
    const run = store.claim("worker", NOW);
    assert.equal(store.syncState().isRunning, true);

    store.finish(run?.id ?? 0, { ok: true }, NOW);
    assert.equal(store.syncState().isRunning, false);
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
    assert.equal(card?.approveCloses, true);
  }),
);

test(
  "sends a message as written without showing it for approval, and gives it back when the send fails",
  withStores((store) => {
    ingest(store, [hit({ text: "no ticket" })]);
    const claudes: Proposal = {
      summary: "Comment",
      steps: [{ type: "jira_comment", issueKey: "PROJ-1", body: "Fix is on dev." }],
    };
    store.act("D01", "Find the related ticket", NOW);
    store.finish(
      store.claim("worker", NOW)?.id ?? 0,
      { ok: true, reply: "PROJ-1.", tools: [], proposal: claudes },
      NOW,
    );
    const written: Proposal = {
      summary: "Send your message as written",
      steps: [{ type: "slack_reply", text: "On it." }],
    };

    assert.equal(store.send("D01", written, NOW), true);
    assert.deepEqual(store.cards()[0]?.pending, { kind: "execute", status: "pending" });
    assert.equal(store.cards()[0]?.proposal, null);

    const run = store.claim("worker", NOW);
    assert.deepEqual(run?.input, { proposal: written });
    store.finish(run?.id ?? 0, { ok: false, error: "Slack is not connected" }, NOW);
    assert.deepEqual(store.cards()[0]?.proposal, written);
    assert.equal(store.cards()[0]?.error, "Slack is not connected");
  }),
);

const OVERLOADED = "Claude did not answer: overloaded (HTTP 529)";

const failDraft = (store: BoardStore, input: { text: string; replyToTs?: string }) => {
  store.request("propose", "D01", input, NOW);
  store.finish(store.claim("worker", NOW)?.id ?? 0, { ok: false, error: OVERLOADED }, NOW);
};

test(
  "tries a failed draft again with the same note and thread, without the note being written again",
  withStores((store) => {
    ingest(store, [hit({ text: "no ticket" })]);
    const note = { text: "say it is done", replyToTs: "1795000000.000100" };
    failDraft(store, note);
    assert.equal(store.cards()[0]?.error, OVERLOADED);
    assert.equal(store.cards()[0]?.canRetry, true);

    assert.equal(store.retry("D01", LATER(1)), true);

    assert.equal(store.cards()[0]?.error, null);
    assert.equal(store.cards()[0]?.canRetry, false);
    const again = store.claim("worker", LATER(1));
    assert.equal(again?.kind, "propose");
    assert.deepEqual(again?.input, note);
  }),
);

test(
  "tries a failed send again with only the steps that did not run",
  withStores((store) => {
    ingest(store, [hit({ text: "no ticket" })]);
    const remaining: Proposal = {
      summary: "Reply and react",
      steps: [{ type: "slack_reaction", emoji: "eyes" }],
    };
    store.approve(
      "D01",
      { ...remaining, steps: [{ type: "slack_reply", text: "Done." }, ...remaining.steps] },
      NOW,
    );
    store.finish(
      store.claim("worker", NOW)?.id ?? 0,
      { ok: false, error: "Step 2 of 2 failed, steps 1 to 1 are done: rate_limited", remaining },
      NOW,
    );

    assert.equal(store.retry("D01", LATER(1)), true);

    const again = store.claim("worker", LATER(1));
    assert.equal(again?.kind, "execute");
    assert.deepEqual(again?.input, { proposal: remaining });
  }),
);

test(
  "leaves nothing to try again once a new draft of the card succeeds",
  withStores((store) => {
    ingest(store, [hit({ text: "no ticket" })]);
    failDraft(store, { text: "say it is done" });

    draftReply(store, "It is done.");

    assert.equal(store.cards()[0]?.canRetry, false);
    assert.equal(store.retry("D01", LATER(1)), false);
  }),
);

const COMMENT: Proposal = {
  summary: "Comment",
  steps: [{ type: "jira_comment", issueKey: "PROJ-1", body: "Fix is on dev." }],
};

const draftReply = (store: BoardStore, text: string): Proposal => {
  const draft: Proposal = { summary: "Reply", steps: [{ type: "slack_reply", text }] };
  store.request("propose", "D01", { text }, NOW);
  store.finish(store.claim("worker", NOW)?.id ?? 0, { ok: true, proposal: draft }, NOW);
  return draft;
};

const answerPrompt = (store: BoardStore, prompt: string, proposal?: Proposal) => {
  store.act("D01", prompt, NOW);
  store.finish(
    store.claim("worker", NOW)?.id ?? 0,
    {
      ok: true,
      reply: "Done looking.",
      tools: [],
      ...(proposal === undefined ? {} : { proposal }),
    },
    NOW,
  );
};

test(
  "keeps a reply draft and the steps Claude proposes in Actions apart, so neither replaces the other",
  withStores((store) => {
    ingest(store, [hit({ text: "no ticket" })]);
    const first = draftReply(store, "First draft.");

    answerPrompt(store, "Comment on the ticket", COMMENT);
    assert.deepEqual(store.cards()[0]?.proposal, first);
    const second = draftReply(store, "Second draft.");

    const [card] = store.cards();
    assert.deepEqual(card?.proposal, second);
    assert.deepEqual(card?.actionProposal, {
      turn: 1,
      proposal: COMMENT,
      approveCloses: false,
      isRunning: false,
    });
  }),
);

test(
  "moves the waiting steps under each newer answer that revises them, and keeps them through an answer without steps",
  withStores((store) => {
    ingest(store, [hit({ text: "no ticket" })]);
    answerPrompt(store, "Comment on the ticket", COMMENT);
    answerPrompt(store, "Who reported it?");
    assert.equal(store.cards()[0]?.actionProposal?.turn, 1);

    const revised: Proposal = {
      summary: "Comment and move",
      steps: [
        ...COMMENT.steps,
        { type: "jira_transition", issueKey: "PROJ-1", transitionId: "31", status: "Review" },
      ],
    };
    answerPrompt(store, "Also move it to review", revised);

    const waiting = store.cards()[0]?.actionProposal;
    assert.deepEqual(
      { turn: waiting?.turn, proposal: waiting?.proposal },
      { turn: 5, proposal: revised },
    );
  }),
);

test(
  "runs the steps approved under an answer only while they still wait there, and shows them running",
  withStores((store) => {
    ingest(store, [hit({ text: "no ticket" })]);
    answerPrompt(store, "Comment on the ticket", COMMENT);
    const edited: Proposal = {
      summary: "Comment",
      steps: [{ type: "jira_comment", issueKey: "PROJ-1", body: "Fix is on staging." }],
    };

    assert.equal(store.approveSteps("D01", 0, edited, NOW), "gone");
    assert.equal(store.approveSteps("D01", 1, edited, NOW), "queued");
    assert.equal(store.approveSteps("D01", 1, edited, NOW), "busy");

    assert.deepEqual(store.cards()[0]?.actionProposal, {
      turn: 1,
      proposal: edited,
      approveCloses: false,
      isRunning: true,
    });
    assert.deepEqual(store.claim("worker", NOW)?.input, { proposal: edited, turn: 1 });
  }),
);

test(
  "after a failed run of steps from Actions shows the error there and keeps only the steps that did not run under the answer",
  withStores((store) => {
    ingest(store, [hit({ text: "no ticket" })]);
    const draft = draftReply(store, "On it.");
    const move: Proposal = {
      summary: "Move PROJ-1 to review",
      steps: [
        { type: "jira_transition", issueKey: "PROJ-1", transitionId: "31", status: "Review" },
      ],
    };
    const both: Proposal = {
      summary: "Comment and move",
      steps: [...COMMENT.steps, ...move.steps],
    };
    answerPrompt(store, "Comment and move it", both);
    store.approveSteps("D01", 1, both, NOW);
    store.finish(
      store.claim("worker", NOW)?.id ?? 0,
      {
        ok: false,
        error: "Step 2 of 2 failed, steps 1 to 1 are done: transition_not_allowed",
        remaining: move,
      },
      LATER(1000),
    );

    const [failed] = store.cards();
    assert.equal(failed?.error, null);
    assert.deepEqual(failed?.proposal, draft);
    assert.deepEqual(
      { turn: failed?.actionProposal?.turn, proposal: failed?.actionProposal?.proposal },
      { turn: 1, proposal: move },
    );
    assert.deepEqual(failed?.actions.at(-1), {
      author: "claude",
      text: "Step 2 of 2 failed, steps 1 to 1 are done: transition_not_allowed",
      at: LATER(1000).toISOString(),
      tools: [],
      isFailed: true,
    });

    assert.equal(store.approveSteps("D01", 1, move, NOW), "queued");
    store.finish(store.claim("worker", NOW)?.id ?? 0, { ok: true }, NOW);

    const [done] = store.cards();
    assert.equal(done?.actionProposal, null);
    assert.deepEqual(done?.proposal, draft);
    assert.equal(done?.actions.at(-1)?.text, "Done: Move PROJ-1 to review");
  }),
);

test(
  "discards the waiting steps only under the answer they wait under, so a stale page cannot drop a newer version",
  withStores((store) => {
    ingest(store, [hit({ text: "no ticket" })]);
    answerPrompt(store, "Comment on the ticket", COMMENT);
    answerPrompt(store, "Comment in English", COMMENT);

    store.discardSteps("D01", 1);
    assert.equal(store.cards()[0]?.actionProposal?.turn, 3);
    store.discardSteps("D01", 3);
    assert.equal(store.cards()[0]?.actionProposal, null);
  }),
);

test(
  "keeps each prompt and Claude's answer as the card's action history",
  withStores((store) => {
    ingest(store, [hit({ text: "no ticket" })]);
    const proposal = COMMENT;

    assert.equal(store.act("D01", "Find the related ticket", NOW), true);
    assert.deepEqual(store.cards()[0]?.pending, { kind: "act", status: "pending" });
    const run = store.claim("worker", NOW);
    assert.deepEqual(
      { kind: run?.kind, input: run?.input },
      {
        kind: "act",
        input: { text: "Find the related ticket" },
      },
    );
    store.finish(
      run?.id ?? 0,
      { ok: true, reply: "PROJ-1 is the one.", tools: ["searchJiraIssuesUsingJql"], proposal },
      LATER(1000),
    );

    const [card] = store.cards();
    assert.deepEqual(card?.actions, [
      {
        author: "me",
        text: "Find the related ticket",
        at: NOW.toISOString(),
        tools: [],
        isFailed: false,
      },
      {
        author: "claude",
        text: "PROJ-1 is the one.",
        at: LATER(1000).toISOString(),
        tools: ["searchJiraIssuesUsingJql"],
        isFailed: false,
      },
    ]);
    assert.equal(card?.pending, null);
  }),
);

test(
  "shows a failed prompt and refused steps in the action history",
  withStores((store) => {
    ingest(store, [hit({ text: "no ticket" })]);
    store.act("D01", "Move it", NOW);
    store.finish(
      store.claim("worker", NOW)?.id ?? 0,
      {
        ok: true,
        reply: "Here is the plan.",
        tools: [],
        proposalError: "x is not an allowed step",
      },
      NOW,
    );
    store.act("D01", "Try again", NOW);
    store.finish(
      store.claim("worker", NOW)?.id ?? 0,
      { ok: false, error: "Claude did not finish" },
      NOW,
    );

    assert.deepEqual(
      store.cards()[0]?.actions.map(({ author, text, isFailed }) => ({ author, text, isFailed })),
      [
        { author: "me", text: "Move it", isFailed: false },
        { author: "claude", text: "Here is the plan.", isFailed: false },
        {
          author: "claude",
          text: "The board refused the steps Claude proposed: x is not an allowed step",
          isFailed: true,
        },
        { author: "me", text: "Try again", isFailed: false },
        { author: "claude", text: "Claude did not finish", isFailed: true },
      ],
    );
    assert.equal(store.cards()[0]?.proposal, null);
  }),
);

test(
  "keeps the card open after approved steps that do not answer the conversation, and logs them",
  withStores((store) => {
    ingest(store, [hit({ text: "no ticket" })]);
    store.approve(
      "D01",
      {
        summary: "Move PROJ-1 to review",
        steps: [
          { type: "jira_transition", issueKey: "PROJ-1", transitionId: "31", status: "Review" },
        ],
      },
      NOW,
    );
    store.finish(store.claim("worker", NOW)?.id ?? 0, { ok: true }, NOW);

    const [card] = store.cards();
    assert.equal(card?.proposal, null);
    assert.deepEqual(
      card?.actions.map(({ author, text }) => ({ author, text })),
      [{ author: "claude", text: "Done: Move PROJ-1 to review" }],
    );
  }),
);

test(
  "gives a running prompt to another worker only after the prompt time limit",
  withStores((store) => {
    ingest(store, [hit({ text: "no ticket" })]);
    store.act("D01", "Find it", NOW);
    const claimed = store.claim("dead", NOW);
    assert.equal(claimed?.kind, "act");

    assert.equal(store.claim("alive", LATER(STALE_CLAIM_MS + 1)), null);
    assert.equal(store.claim("alive", LATER(ACT_STALE_MS)), null);
    assert.equal(store.claim("alive", LATER(ACT_STALE_MS + 1))?.id, claimed?.id);
  }),
);

test(
  "reads the conversation from Slack once per new message and marks my messages in it",
  withStores((store) => {
    ingest(store, [hit({ text: "no ticket" })]);

    assert.equal(store.requestHistory("D01", NOW), true);
    assert.equal(store.requestHistory("D01", NOW), false);
    const read = store.claim("worker", NOW);
    assert.deepEqual(
      { kind: read?.kind, input: read?.input },
      {
        kind: "history",
        input: { key: "D01", channelId: "D01", threadTs: null, latestTs: "1795000000.000100" },
      },
    );
    store.finish(
      read?.id ?? 0,
      {
        ok: true,
        history: [
          { ts: "1794999000.000000", authorId: ME, authorName: "Me", text: "Shipped." },
          { ts: "1795000000.000100", authorId: "U_ANA", authorName: "Ana", text: "no ticket" },
        ],
      },
      NOW,
    );

    assert.deepEqual(
      store
        .cards()[0]
        ?.conversation.map(({ text, isMine, startsNew }) => ({ text, isMine, startsNew })),
      [
        { text: "Shipped.", isMine: true, startsNew: false },
        { text: "no ticket", isMine: false, startsNew: true },
      ],
    );
    assert.equal(store.requestHistory("D01", NOW), false);
    ingest(store, [hit({ text: "no ticket" }), hit({ ts: "1795000001.000000", text: "hello?" })]);
    assert.equal(store.requestHistory("D01", NOW), true);
  }),
);

test(
  "says why the conversation could not be read and shows the waiting messages instead",
  withStores((store) => {
    ingest(store, [hit({ text: "no ticket" })]);
    store.requestHistory("D01", NOW);
    store.finish(
      store.claim("worker", NOW)?.id ?? 0,
      { ok: false, error: "channel_not_found" },
      NOW,
    );

    const [card] = store.cards();
    assert.equal(card?.historyError, "channel_not_found");
    assert.deepEqual(
      card?.conversation.map((message) => message.text),
      ["no ticket"],
    );
    assert.equal(store.requestHistory("D01", NOW), true);
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

test(
  "keeps messages from my channels across syncs, summed up per channel, with the messages of opened channels only",
  withStores((store) => {
    ingestChannels(store, [
      channelHit({ ts: "1795000000.000100", text: "first" }),
      channelHit({ ts: "1795000500.000000", text: "second" }),
      channelHit({ channelId: "C02", channelLabel: "#ops", ts: "1795000600.000000", text: "ops" }),
    ]);
    ingestChannels(store, [], { now: LATER(60_000) });

    const message = (ts: string, text: string) => ({
      key: `C01:${ts}`,
      channelId: "C01",
      channelLabel: "#backend",
      ts,
      authorName: "Bob",
      text,
      permalink: "https://example.slack.com/archives/D01/p1795000000000100",
    });
    assert.deepEqual(store.otherMessages(new Set(["C01"])), {
      total: 3,
      isMissing: false,
      channels: [
        {
          channelId: "C02",
          label: "#ops",
          count: 1,
          latestTs: "1795000600.000000",
          messages: null,
        },
        {
          channelId: "C01",
          label: "#backend",
          count: 2,
          latestTs: "1795000500.000000",
          messages: [message("1795000000.000100", "first"), message("1795000500.000000", "second")],
        },
      ],
    });

    const firstOutOfLookback = new Date(1795000001 * 1000 + LOOKBACK_DAYS * DAY_MS);
    ingestChannels(store, [], { now: firstOutOfLookback });
    assert.deepEqual(otherTexts(store), ["second"]);
  }),
);

test(
  "marks a channel read up to the newest message shown, so later ones stay and the next sync brings no read one back",
  withStores((store) => {
    const shown = [
      channelHit({ ts: "1795000100.000000", text: "first" }),
      channelHit({ ts: "1795000200.000000", text: "second" }),
    ];
    const later = channelHit({ ts: "1795000300.000000", text: "came while reading" });
    const ops = channelHit({ channelId: "C02", channelLabel: "#ops", ts: "1795000150.000000" });
    ingestChannels(store, [...shown, ops]);
    ingestChannels(store, [...shown, later, ops], { now: LATER(60_000) });

    store.markChannelsRead([{ channelId: "C01", throughTs: "1795000200.000000" }]);
    store.markChannelsRead([{ channelId: "C01", throughTs: "1795000100.000000" }]);
    ingestChannels(store, [...shown, later, ops], { now: LATER(120_000) });

    assert.deepEqual(otherTexts(store), ["came while reading"]);
    assert.equal(store.otherMessages(NO_CHANNEL_OPEN).total, 2);
  }),
);

test(
  "never shows a channel message that is on a card, was ignored there, or that I answered in its thread",
  withStores((store) => {
    const mention = channelHit({ ts: "1795000100.000000", text: `<@${ME}> look` });
    const answered = channelHit({ ts: "1795000200.000000", text: "answered" });
    const plain = channelHit({ ts: "1795000300.000000", text: "plain" });
    const myReply = channelHit({
      ts: "1795000250.000000",
      threadTs: "1795000200.000000",
      author: { id: ME, name: "Me" },
    });
    const channelHits = [mention, answered, plain];
    ingestChannels(store, channelHits, { hits: [mention], myHits: [myReply] });
    assert.deepEqual(otherTexts(store), ["plain"]);

    store.ignore("C01:1795000100.000000", NOW);
    ingestChannels(store, channelHits, { hits: [mention], myHits: [myReply], now: LATER(60_000) });
    assert.deepEqual(otherTexts(store), ["plain"]);

    const askedInThread = channelHit({
      ts: "1795000350.000000",
      threadTs: "1795000300.000000",
      text: `<@${ME}> and you?`,
    });
    ingestChannels(store, [], { hits: [askedInThread], now: LATER(120_000) });
    assert.deepEqual(otherTexts(store), []);
  }),
);

test(
  "turns a person's @here into a card and leaves a bot's @channel among the other messages",
  withStores((store) => {
    ingestChannels(store, [
      channelHit({ ts: "1795000100.000000", text: "<!here> standup moved" }),
      channelHit({
        ts: "1795000200.000000",
        author: { id: "U_BOT", name: "Alarms" },
        isBot: true,
        text: "<!channel> disk full",
      }),
      channelHit({ ts: "1795000300.000000", text: "lunch?" }),
    ]);

    assert.deepEqual(
      store.cards().map((card) => [card.key, card.messages.map((message) => message.text)]),
      [["C01:1795000100.000000", ["<!here> standup moved"]]],
    );
    assert.deepEqual(otherTexts(store), ["<!channel> disk full", "lunch?"]);
  }),
);

test(
  "turns a bot's message that mentions me into a card, not an other message",
  withStores((store) => {
    const digest = channelHit({
      ts: "1795000100.000000",
      author: { id: "U00", name: "" },
      isBot: true,
      text: `<@${ME}|Me>: review back-end #2528`,
    });

    ingestChannels(store, [digest], { hits: [digest] });

    assert.deepEqual(
      store
        .cards()
        .map((card) => [
          card.key,
          card.messages.map((message) => [message.authorName, message.text]),
        ]),
      [["C01:1795000100.000000", [["Slack app", `<@${ME}|Me>: review back-end #2528`]]]],
    );
    assert.deepEqual(otherTexts(store), []);
  }),
);

test(
  "says messages are missing after a sync found more than it loads, until all are marked read or the lookback passes",
  withStores((store) => {
    const backend = channelHit({ ts: "1795000100.000000" });
    const ops = channelHit({ channelId: "C02", channelLabel: "#ops", ts: "1795000200.000000" });
    ingestChannels(store, [backend, ops], { hasMore: true });
    ingestChannels(store, [], { now: LATER(60_000) });
    store.markChannelsRead([{ channelId: "C01", throughTs: backend.ts }]);
    assert.equal(store.otherMessages(NO_CHANNEL_OPEN).isMissing, true);

    store.markAllChannelsRead([{ channelId: "C02", throughTs: ops.ts }]);
    assert.deepEqual(store.otherMessages(NO_CHANNEL_OPEN), {
      total: 0,
      isMissing: false,
      channels: [],
    });

    ingestChannels(store, [], { hasMore: true, now: LATER(120_000) });
    const truncatedSyncOutOfLookback = new Date(LATER(121_000).getTime() + LOOKBACK_DAYS * DAY_MS);
    ingestChannels(store, [], { now: truncatedSyncOutOfLookback });
    assert.equal(store.otherMessages(NO_CHANNEL_OPEN).isMissing, false);
  }),
);
