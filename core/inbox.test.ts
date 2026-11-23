import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dropAnswered,
  mentionsEveryone,
  mergeHits,
  newMessages,
  peopleFromHits,
  threadTargetFor,
} from "./inbox.ts";
import type { InboxCard, SlackHit } from "./types.ts";

const ME = "U_ME";
const ANA = { id: "U_ANA", name: "Ana Novak" };
const BOB = { id: "U_BOB", name: "Bob Kral" };
const MYSELF = { id: ME, name: "Me Person" };

const hit = (overrides: Partial<SlackHit>): SlackHit => ({
  channelId: "D01",
  channelLabel: "DM",
  kind: "dm",
  participants: [MYSELF, ANA],
  author: ANA,
  isBot: false,
  ts: "1795000000.000100",
  threadTs: null,
  permalink: "https://example.slack.com/archives/D01/p1795000000000100",
  text: "hello",
  ...overrides,
});

const NO_IGNORED = new Map<string, string>();

test("finds the messages a sync added: all of a new conversation's, only the newer ones of a known one", () => {
  const before = mergeHits([], [hit({ ts: "1795000000.000100", text: "first" })], ME, NO_IGNORED);
  const after = mergeHits(
    before,
    [
      hit({ ts: "1795000000.000100", text: "first" }),
      hit({ ts: "1795000000.000200", text: "second" }),
      hit({ channelId: "D02", author: BOB, participants: [MYSELF, BOB], text: "from Bob" }),
    ],
    ME,
    NO_IGNORED,
  );

  const added = newMessages(before, after).map((news) => [news.cardKey, news.message.text]);

  assert.deepEqual(added, [
    ["D01", "second"],
    ["D02", "from Bob"],
  ]);
  assert.deepEqual(newMessages(after, after), []);
});

test("groups messages for me into one card per conversation, with the place a reply goes", () => {
  const cards = mergeHits(
    [],
    [
      hit({ ts: "1795000000.000200", text: "second" }),
      hit({ ts: "1795000000.000100", text: "first" }),
      hit({ ts: "1795000000.000100", text: "first" }),
      hit({
        channelId: "D02",
        ts: "1795000001.000000",
        threadTs: "1795000000.900000",
        author: BOB,
        participants: [MYSELF, BOB],
      }),
      hit({
        channelId: "C01",
        channelLabel: "#backend",
        kind: "channel",
        participants: [],
        author: BOB,
        ts: "1795000002.000000",
      }),
      hit({
        channelId: "C01",
        channelLabel: "#backend",
        kind: "channel",
        participants: [],
        author: BOB,
        ts: "1795000003.000000",
        threadTs: "1795000000.500000",
      }),
      hit({
        channelId: "C02",
        kind: "group",
        channelLabel: "Group DM",
        participants: [MYSELF, ANA, BOB],
        author: BOB,
        ts: "1795000004.000000",
      }),
    ],
    ME,
    NO_IGNORED,
  );

  assert.deepEqual(
    cards.map((card) => ({
      key: card.key,
      title: card.title,
      target: card.target,
      texts: card.messages.map((m) => m.text),
    })),
    [
      {
        key: "D01",
        title: "Ana Novak",
        target: { channelId: "D01", threadTs: null },
        texts: ["first", "second"],
      },
      {
        key: "D02:1795000000.900000",
        title: "Bob Kral",
        target: { channelId: "D02", threadTs: "1795000000.900000" },
        texts: ["hello"],
      },
      {
        key: "C01:1795000002.000000",
        title: "#backend",
        target: { channelId: "C01", threadTs: "1795000002.000000" },
        texts: ["hello"],
      },
      {
        key: "C01:1795000000.500000",
        title: "#backend",
        target: { channelId: "C01", threadTs: "1795000000.500000" },
        texts: ["hello"],
      },
      {
        key: "C02",
        title: "Ana Novak, Bob Kral",
        target: { channelId: "C02", threadTs: null },
        texts: ["hello"],
      },
    ],
  );
});

test("keeps who wrote each message so the board can show and filter by person", () => {
  const [card] = mergeHits([], [hit({})], ME, NO_IGNORED);

  assert.deepEqual(card?.messages[0], {
    ts: "1795000000.000100",
    authorId: "U_ANA",
    authorName: "Ana Novak",
    text: "hello",
    permalink: "https://example.slack.com/archives/D01/p1795000000000100",
  });
});

test("replies to a clicked message in its thread: the existing thread, or a new one under a top-level message", () => {
  assert.deepEqual(
    threadTargetFor({ channelId: "C01", threadTs: "1795000000.500000" }, "1795000003.000000"),
    { channelId: "C01", threadTs: "1795000000.500000" },
  );
  assert.deepEqual(threadTargetFor({ channelId: "D01", threadTs: null }, "1795000000.000100"), {
    channelId: "D01",
    threadTs: "1795000000.000100",
  });
  assert.deepEqual(threadTargetFor({ channelId: "D01", threadTs: null }, null), {
    channelId: "D01",
    threadTs: null,
  });
});

test("collects the people and channels I can write to from synced messages, never myself or bots", () => {
  const people = peopleFromHits(
    [
      hit({}),
      hit({
        author: BOB,
        channelId: "C01",
        channelLabel: "#backend",
        kind: "channel",
        participants: [],
      }),
      hit({ author: MYSELF }),
      hit({ author: { id: "U00", name: "" }, isBot: true }),
    ],
    ME,
  );

  assert.deepEqual(people, [
    { channelId: "U_ANA", label: "Ana Novak", kind: "person" },
    { channelId: "U_BOB", label: "Bob Kral", kind: "person" },
    { channelId: "C01", label: "#backend", kind: "channel" },
  ]);
});

test("leaves out my own messages and bot messages", () => {
  const cards = mergeHits(
    [],
    [hit({ author: MYSELF }), hit({ author: { id: "U00", name: "" }, isBot: true })],
    ME,
    NO_IGNORED,
  );

  assert.deepEqual(cards, []);
});

test("adds new messages to an existing card in time order", () => {
  const existing: InboxCard[] = mergeHits(
    [],
    [hit({ ts: "1795000000.000200", text: "old" })],
    ME,
    NO_IGNORED,
  );

  const cards = mergeHits(
    existing,
    [
      hit({ ts: "1795000000.000150", text: "between" }),
      hit({ ts: "1795000000.000300", text: "new" }),
    ],
    ME,
    NO_IGNORED,
  );

  assert.deepEqual(
    cards[0]?.messages.map((m) => m.text),
    ["between", "old", "new"],
  );
});

test("keeps an ignored conversation away until a message newer than the ignored one arrives", () => {
  const ignored = new Map([["D01", "1795000000.000200"]]);

  assert.deepEqual(mergeHits([], [hit({ ts: "1795000000.000200" })], ME, ignored), []);
  assert.deepEqual(
    mergeHits(
      [],
      [
        hit({ ts: "1795000000.000200", text: "seen" }),
        hit({ ts: "1795000000.000201", text: "fresh" }),
      ],
      ME,
      ignored,
    )[0]?.messages.map((m) => m.text),
    ["fresh"],
  );
});

test("removes what I answered in Slack and keeps what came after my reply", () => {
  const cards = mergeHits(
    [],
    [
      hit({ ts: "1795000000.000100", text: "answered" }),
      hit({ ts: "1795000000.000300", text: "after my reply" }),
      hit({
        channelId: "C01",
        channelLabel: "#backend",
        kind: "channel",
        participants: [],
        ts: "1795000002.000000",
      }),
    ],
    ME,
    NO_IGNORED,
  );

  const left = dropAnswered(cards, [
    hit({ author: MYSELF, ts: "1795000000.000200" }),
    hit({
      channelId: "C01",
      kind: "channel",
      participants: [],
      author: MYSELF,
      ts: "1795000009.000000",
      threadTs: "1795000002.000000",
    }),
  ]);

  assert.deepEqual(
    left.map((card) => ({ key: card.key, texts: card.messages.map((m) => m.text) })),
    [{ key: "D01", texts: ["after my reply"] }],
  );
});

test("counts @here, @channel and @everyone as mentions of me, not the word here or a user group", () => {
  const cases: [string, boolean][] = [
    ["<!here> standup in 5", true],
    ["Deploy at noon <!channel>", true],
    ["<!everyone> office is closed", true],
    ["<!here|here> labelled", true],
    ["Please reply here", false],
    ["<!subteam^S0123|@backend> review this", false],
  ];

  assert.deepEqual(
    cases.map(([text]) => [text, mentionsEveryone(text)]),
    cases,
  );
});
