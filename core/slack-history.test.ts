import assert from "node:assert/strict";
import { test } from "node:test";
import { readHistory } from "./slack-history.ts";

const THREAD = JSON.stringify({
  messages: [
    "=== THREAD PARENT MESSAGE ===",
    "From: Ana Novak <ana@example.com> (U_ANA)",
    "Time: 2026-11-17 21:22:33 +07",
    "Message TS: 1794925353.393529",
    "Can you check PROJ-1?",
    "Second line",
    "",
    "=== THREAD REPLIES (2 total) ===",
    "",
    "--- Reply 1 of 2 ---",
    "From: Me Person <me@example.com> (U_ME)",
    "Time: 2026-11-19 14:54:14 +07",
    "Message TS: 1795074854.653729",
    "On it.",
    "Reactions: +1::skin-tone-2 (1), +1 (1)",
    "",
    "--- Reply 2 of 2 ---",
    "From: Ana Novak <ana@example.com> (U_ANA)",
    "Time: 2026-11-20 20:49:51 +07",
    "Message TS: 1795182591.160269",
    "Any news?",
    "",
  ].join("\n"),
  pagination_info: "There are no more messages in this thread.\n",
});

const LONELY_PARENT = JSON.stringify({
  messages: [
    "=== THREAD PARENT MESSAGE ===",
    "From: Ana Novak <ana@example.com> (U_ANA)",
    "Time: 2026-11-21 00:25:22 +07",
    "Message TS: 1795195522.072509",
    "Anyone?",
    "",
    "No thread messsages",
    "",
  ].join("\n"),
  pagination_info: "There are no more messages in this thread.\n",
});

const DM = JSON.stringify({
  messages: [
    "Channel: DM (D01)",
    "",
    "=== Message from Me Person <me@example.com> (U_ME) at 2026-11-20 02:10:52 +07 === ",
    "Message TS: 1795115452.449449",
    "Glad it helped",
    "Reactions: blue_heart (1)",
    "",
    "=== Message from Ana Novak <ana@example.com> (U_ANA) at 2026-11-20 02:09:42 +07 === ",
    "Message TS: 1795115382.121529",
    "Thank you!",
    "It saves me hours.",
  ].join("\n"),
  pagination_info: "There are more messages available. To view the next page, use cursor: `abc`\n",
});

test("reads a thread and a DM into messages oldest first, keeping who wrote each and nothing else about them", () => {
  assert.deepEqual(readHistory(THREAD), [
    {
      ts: "1794925353.393529",
      authorId: "U_ANA",
      authorName: "Ana Novak",
      text: "Can you check PROJ-1?\nSecond line",
    },
    { ts: "1795074854.653729", authorId: "U_ME", authorName: "Me Person", text: "On it." },
    { ts: "1795182591.160269", authorId: "U_ANA", authorName: "Ana Novak", text: "Any news?" },
  ]);
  assert.deepEqual(readHistory(LONELY_PARENT), [
    { ts: "1795195522.072509", authorId: "U_ANA", authorName: "Ana Novak", text: "Anyone?" },
  ]);
  assert.deepEqual(readHistory(DM), [
    {
      ts: "1795115382.121529",
      authorId: "U_ANA",
      authorName: "Ana Novak",
      text: "Thank you!\nIt saves me hours.",
    },
    { ts: "1795115452.449449", authorId: "U_ME", authorName: "Me Person", text: "Glad it helped" },
  ]);
  assert.doesNotMatch(JSON.stringify([readHistory(THREAD), readHistory(DM)]), /example\.com/);
});

test("refuses an answer that is not a Slack message history", () => {
  assert.throws(() => readHistory("channel_not_found"), /not a Slack message history/);
});
