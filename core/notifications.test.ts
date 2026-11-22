import assert from "node:assert/strict";
import { test } from "node:test";
import {
  finishNotice,
  MESSAGE_NOTICE_LIMIT,
  NOTICE_TEXT_CHARS,
  newMessageNotices,
} from "./notifications.ts";
import type { ConversationKind, FinishOutcome, NewMessage, RequestKind } from "./types.ts";

const news = (
  cardKey: string,
  authorName: string,
  text: string,
  kind: ConversationKind = "dm",
  title = authorName,
): NewMessage => ({
  cardKey,
  kind,
  title,
  message: { ts: "1795000000.000100", authorId: `U_${cardKey}`, authorName, text, permalink: "" },
});

const conversations = (count: number): NewMessage[] =>
  Array.from({ length: count }, (_, index) => news(`D${index}`, `Person ${index}`, "hi"));

test("titles a new message by who wrote it and where, and shows its text as plain words", () => {
  const notices = newMessageNotices([
    news("D01", "Ana Novak", "Can you check <@U1|Bob> &amp;\nthe   release?"),
    news("G01", "Ana Novak", "group note", "group", "Ana Novak, Bob Kral"),
    news("C01", "Ana Novak", "older", "channel", "#release"),
    news("C01", "Ana Novak", "newest", "channel", "#release"),
  ]);

  assert.deepEqual(
    notices.map(({ key, title, text }) => [key, title, text]),
    [
      ["message:D01", "Ana Novak", "Can you check @Bob & the release?"],
      ["message:G01", "Ana Novak, Bob Kral", "group note"],
      ["message:C01", "Ana Novak in #release", "newest"],
    ],
  );
});

test("sums up new messages in one notice once more conversations than the limit have news", () => {
  assert.equal(newMessageNotices(conversations(MESSAGE_NOTICE_LIMIT)).length, MESSAGE_NOTICE_LIMIT);

  const [summary, ...rest] = newMessageNotices([
    ...conversations(MESSAGE_NOTICE_LIMIT + 1),
    news("D0", "Person 0", "again"),
  ]);

  assert.deepEqual(rest, []);
  assert.deepEqual(
    { key: summary?.key, text: summary?.text },
    {
      key: "messages",
      text: `${MESSAGE_NOTICE_LIMIT + 2} new messages from Person 0, Person 1 and ${MESSAGE_NOTICE_LIMIT - 1} others`,
    },
  );
});

test("cuts a notice's text to its length", () => {
  const fits = "a".repeat(NOTICE_TEXT_CHARS);
  const [whole] = newMessageNotices([news("D01", "Ana Novak", fits)]);
  const [cut] = newMessageNotices([news("D01", "Ana Novak", `${fits}b`)]);

  assert.equal(whole?.text, fits);
  assert.equal(cut?.text, `${"a".repeat(NOTICE_TEXT_CHARS - 1)}…`);
});

test("tells about a finished draft or answer and a failed send, under the setting each belongs to", () => {
  const card = { key: "D01", title: "Ana Novak" };
  const cases: [RequestKind, FinishOutcome, [string, string] | null][] = [
    ["propose", { ok: true }, ["claudeDone", "Draft ready to approve"]],
    [
      "propose",
      { ok: false, error: "No reply" },
      ["claudeDone", "Claude could not draft: No reply"],
    ],
    ["act", { ok: true, reply: "PROJ-1." }, ["claudeDone", "Claude answered your prompt"]],
    [
      "act",
      { ok: false, error: "Timed out" },
      ["claudeDone", "Claude could not finish your prompt: Timed out"],
    ],
    [
      "execute",
      { ok: false, error: "channel_not_found" },
      ["sendFailed", "Not sent: channel_not_found"],
    ],
    ["execute", { ok: true }, null],
    ["history", { ok: false, error: "Slack is down" }, null],
  ];

  for (const [kind, outcome, expected] of cases) {
    const notice = finishNotice(kind, outcome, card);
    assert.deepEqual(notice === null ? null : [notice.event, notice.text], expected);
    if (notice !== null) assert.deepEqual([notice.key, notice.title], ["card:D01", "Ana Novak"]);
  }
});
