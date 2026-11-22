import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cardNotices,
  MESSAGE_NOTICE_LIMIT,
  NOTICE_TEXT_CHARS,
  newsNotices,
  syncNotices,
} from "./notifications.js";

const news = (cardKey, authorName, text, kind = "dm", title = authorName) => ({
  cardKey,
  kind,
  title,
  message: { ts: "1795000000.000100", authorId: `U_${cardKey}`, authorName, text, permalink: "" },
});

const batch = (at, items) => ({ at, items });

const conversations = (count) =>
  Array.from({ length: count }, (_, index) => news(`D${index}`, `Person ${index}`, "hi"));

const shown = (notices) =>
  notices.map(({ tag, title, body, cardKey }) => [tag, title, body, cardKey]);

test("titles a new message by who wrote it and where, and shows its text as plain words", () => {
  const notices = newsNotices(
    null,
    batch("2026-11-22T10:00:00.000Z", [
      news("D01", "Ana Novak", "Can you check <@U1|Bob> &amp;\nthe   release?"),
      news("G01", "Ana Novak", "group note", "group", "Ana Novak, Bob Kral"),
      news("C01", "Ana Novak", "older", "channel", "#release"),
      news("C01", "Ana Novak", "newest", "channel", "#release"),
    ]),
  );

  assert.deepEqual(shown(notices), [
    ["message:D01", "Ana Novak", "Can you check @Bob & the release?", "D01"],
    ["message:G01", "Ana Novak, Bob Kral", "group note", "G01"],
    ["message:C01", "Ana Novak in #release", "newest", "C01"],
  ]);
});

test("notifies about a batch of new messages once, when the board sees it first", () => {
  const first = batch("2026-11-22T10:00:00.000Z", [news("D01", "Ana Novak", "hi")]);

  assert.equal(newsNotices(first, first).length, 0);
  assert.equal(newsNotices(null, null).length, 0);
  assert.equal(newsNotices(first, batch("2026-11-22T10:05:00.000Z", first.items)).length, 1);
});

test("sums up new messages in one notice once more conversations than the limit have news", () => {
  const at = "2026-11-22T10:00:00.000Z";
  assert.equal(
    newsNotices(null, batch(at, conversations(MESSAGE_NOTICE_LIMIT))).length,
    MESSAGE_NOTICE_LIMIT,
  );

  const notices = newsNotices(
    null,
    batch(at, [...conversations(MESSAGE_NOTICE_LIMIT + 1), news("D0", "Person 0", "again")]),
  );

  assert.deepEqual(shown(notices), [
    [
      "messages",
      "Slack Board",
      `${MESSAGE_NOTICE_LIMIT + 2} new messages from Person 0, Person 1 and ${MESSAGE_NOTICE_LIMIT - 1} others`,
      null,
    ],
  ]);
});

test("cuts a notice's text to its length", () => {
  const fits = "a".repeat(NOTICE_TEXT_CHARS);
  const at = "2026-11-22T10:00:00.000Z";
  const [whole] = newsNotices(null, batch(at, [news("D01", "Ana Novak", fits)]));
  const [cut] = newsNotices(null, batch(at, [news("D01", "Ana Novak", `${fits}b`)]));

  assert.equal(whole?.body, fits);
  assert.equal(cut?.body, `${"a".repeat(NOTICE_TEXT_CHARS - 1)}…`);
});

test("tells about Claude's finished work and a failed send, under the setting each belongs to", () => {
  const card = (overrides) => ({
    key: "D01",
    title: "Ana Novak",
    error: null,
    actions: [],
    ...overrides,
  });
  const turn = (text, isFailed) => ({ author: "claude", text, isFailed });
  const cases = [
    [{ kind: "proposal", card: card({}) }, ["claudeDone", "Proposal ready to approve"]],
    [
      { kind: "answered", card: card({ actions: [turn("PROJ-1.", false)] }) },
      ["claudeDone", "Claude answered your prompt"],
    ],
    [
      { kind: "answered", card: card({ actions: [turn("Timed out", true)] }) },
      ["claudeDone", "Claude could not finish your prompt: Timed out"],
    ],
    [
      { kind: "failed", work: "propose", card: card({ error: "No reply" }) },
      ["claudeDone", "Claude could not draft: No reply"],
    ],
    [
      { kind: "failed", work: "execute", card: card({ error: "channel_not_found" }) },
      ["sendFailed", "Not sent: channel_not_found"],
    ],
    [{ kind: "sent", card: card({}) }, null],
  ];

  for (const [change, expected] of cases) {
    const notices = cardNotices([change]);
    assert.deepEqual(
      notices.map((notice) => [notice.event, notice.body]),
      expected === null ? [] : [expected],
    );
  }
  assert.deepEqual(shown(cardNotices([cases[0][0]])), [
    ["card:D01", "Ana Novak", "Proposal ready to approve", "D01"],
  ]);
});

test("tells once when syncing starts failing", () => {
  const ok = { lastSyncAt: null, lastError: null, isRunning: false };
  const failing = { ...ok, lastError: "Slack is not connected" };

  assert.deepEqual(shown(syncNotices(ok, failing)), [
    ["sync", "Slack sync failed", "Slack is not connected", null],
  ]);
  assert.deepEqual(syncNotices(failing, { ...failing, lastError: "Still down" }), []);
});
