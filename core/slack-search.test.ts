import assert from "node:assert/strict";
import { test } from "node:test";
import { readRecipients, readSearchPage } from "./slack-search.ts";

const block = (lines: string[]): string => `${lines.join("\n")}\n\n---\n\n`;

const RESULTS = [
  "# Search Results for: \n\n## Messages (3 results)\n### Result 1 of 3\n",
  block([
    "Channel: DM (ID: D01)",
    "Participants: Me Person (ID: U_ME), Ana Novak (ID: U_ANA)",
    "From: Ana Novak <ana@example.com> (ID: U_ANA) ",
    "Time: 2026-11-20 23:59:12 +07",
    "Message_ts: 1795193952.548639",
    "Permalink: [link](https://example.slack.com/archives/D01/p1795193952548639)",
    "Text: ",
    "First line",
    "second line",
  ]),
  "### Result 2 of 3\n",
  block([
    "Channel: #backend (ID: C02)",
    "From: Bob Kral <bob@example.com> (ID: U_BOB) ",
    "Time: 2026-11-21 15:00:31 +07",
    "Message_ts: 1795248031.662819",
    "Permalink: [link](https://example.slack.com/archives/C02/p1795248031662819?thread_ts=1795218202.725979&cid=C02)",
    "Text: ",
    "Thread reply",
  ]),
  "### Result 3 of 3\n",
  block([
    "Channel: #alarms (ID: C03)",
    "From:  (ID: U00)  [BOT]",
    "Time: 2026-11-21 06:43:22 +07",
    "Message_ts: 1795218202.725979",
    "Reply count: 1",
    "Permalink: [link](https://example.slack.com/archives/C03/p1795218202725979)",
    "Text: ",
    "Scraper failed",
  ]),
].join("");

const PAGE = JSON.stringify({
  results: RESULTS,
  pagination_info: "For the next page of results use cursor `Q1VSUkVOVF9QQUdFOjI=`\n",
});

test("reads hits from a detailed search page", () => {
  const page = readSearchPage(PAGE);

  assert.deepEqual(page.hits, [
    {
      channelId: "D01",
      channelLabel: "DM",
      kind: "dm",
      participants: [
        { id: "U_ME", name: "Me Person" },
        { id: "U_ANA", name: "Ana Novak" },
      ],
      author: { id: "U_ANA", name: "Ana Novak" },
      isBot: false,
      ts: "1795193952.548639",
      threadTs: null,
      permalink: "https://example.slack.com/archives/D01/p1795193952548639",
      text: "First line\nsecond line",
    },
    {
      channelId: "C02",
      channelLabel: "#backend",
      kind: "channel",
      participants: [],
      author: { id: "U_BOB", name: "Bob Kral" },
      isBot: false,
      ts: "1795248031.662819",
      threadTs: "1795218202.725979",
      permalink:
        "https://example.slack.com/archives/C02/p1795248031662819?thread_ts=1795218202.725979&cid=C02",
      text: "Thread reply",
    },
    {
      channelId: "C03",
      channelLabel: "#alarms",
      kind: "channel",
      participants: [],
      author: { id: "U00", name: "" },
      isBot: true,
      ts: "1795218202.725979",
      threadTs: null,
      permalink: "https://example.slack.com/archives/C03/p1795218202725979",
      text: "Scraper failed",
    },
  ]);
  assert.equal(page.cursor, "Q1VSUkVOVF9QQUdFOjI=");
});

test("marks a non-DM conversation with participants as a group DM", () => {
  const group = JSON.stringify({
    results: block([
      "### Result 1 of 1",
      "Channel: Group DM (ID: C09)",
      "Participants: Me Person (ID: U_ME), Ana Novak (ID: U_ANA), Bob Kral (ID: U_BOB)",
      "From: Bob Kral <bob@example.com> (ID: U_BOB) ",
      "Message_ts: 1795193952.000001",
      "Permalink: [link](https://example.slack.com/archives/C09/p1795193952000001)",
      "Text: ",
      "Hi both",
    ]),
  });

  assert.equal(readSearchPage(group).hits[0]?.kind, "group");
});

test("has no cursor and no hits on an empty last page", () => {
  assert.deepEqual(
    readSearchPage(JSON.stringify({ results: "# Search Results for: \n\nNo results found." })),
    {
      hits: [],
      cursor: null,
    },
  );
});

test("reads people and channels to write to, without their emails", () => {
  const users = JSON.stringify({
    results:
      "# Search Results for: \n\n## Users (2 results)\n1. Ana Novak - U0ANA1 - ana@example.com - Backend Developer\n2. Bob Kral - U0BOB2 - bob@example.com - QA\n",
  });
  const channels = JSON.stringify({
    results:
      "# Search Results for: \n\n## Channels (1 results)\n1. #backend_ts (C0936N3QEKU) - private_channel - Creator: Ana Novak  - 2025-06-26 - Not Archived\n",
  });

  assert.deepEqual(readRecipients(users, channels), [
    { channelId: "U0ANA1", label: "Ana Novak", kind: "person" },
    { channelId: "U0BOB2", label: "Bob Kral", kind: "person" },
    { channelId: "C0936N3QEKU", label: "#backend_ts", kind: "channel" },
  ]);
});

test("rejects a page that is not a search result", () => {
  assert.throws(() => readSearchPage("Internal error"), /not a Slack search result/);
});
