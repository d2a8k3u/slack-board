import assert from "node:assert/strict";
import { test } from "node:test";
import { channelMessagesAfterSync } from "./channel-messages.ts";
import type { ChannelMessage, SlackHit } from "./types.ts";

const ME = "U_ME";
const BOB = { id: "U_BOB", name: "Bob Kral" };
const NOTHING_READ = new Map<string, string>();

const hit = (overrides: Partial<SlackHit>): SlackHit => ({
  channelId: "C01",
  channelLabel: "#backend",
  kind: "channel",
  participants: [],
  author: BOB,
  isBot: false,
  ts: "1795000010.000000",
  threadTs: null,
  permalink: "https://example.slack.com/archives/C01/p1795000010000000",
  text: "Deploy is done",
  ...overrides,
});

const stored = (overrides: Partial<ChannelMessage>): ChannelMessage => ({
  key: "C01:1795000010.000000",
  channelId: "C01",
  channelLabel: "#backend",
  ts: "1795000010.000000",
  authorName: "Bob Kral",
  text: "Deploy is done",
  permalink: "https://example.slack.com/archives/C01/p1795000010000000",
  ...overrides,
});

test("keeps what others posted to a channel itself, after its read mark and within the lookback", () => {
  const kept = channelMessagesAfterSync({
    stored: [],
    hits: [
      hit({ ts: "1795000010.000000" }),
      hit({ ts: "1795000011.000000", threadTs: "1795000011.000000", text: "parent" }),
      hit({ ts: "1795000012.000000", author: { id: "U00", name: "" }, isBot: true, text: "" }),
      hit({ ts: "1795000013.000000", threadTs: "1795000011.000000", text: "reply" }),
      hit({ ts: "1795000014.000000", author: { id: ME, name: "Me" }, text: "mine" }),
      hit({ ts: "1795000015.000000", channelId: "D01", kind: "dm", text: "dm" }),
      hit({ ts: "1795000016.000000", text: "on a card" }),
      hit({ ts: "1795000020.000000", channelId: "C02", channelLabel: "#ops", text: "read" }),
      hit({ ts: "1795000020.000001", channelId: "C02", channelLabel: "#ops", text: "unread" }),
      hit({ ts: "1795000000.999999", text: "too old" }),
      hit({ ts: "1795000001.000000", text: "just in" }),
    ],
    me: ME,
    covered: new Set(["C01:1795000016.000000"]),
    readThrough: new Map([["C02", "1795000020.000000"]]),
    keepFromTs: "1795000001",
  });

  assert.deepEqual(
    kept.map((message) => [message.key, message.authorName, message.text]),
    [
      ["C01:1795000001.000000", "Bob Kral", "just in"],
      ["C01:1795000010.000000", "Bob Kral", "Deploy is done"],
      ["C01:1795000011.000000", "Bob Kral", "parent"],
      ["C01:1795000012.000000", "Slack app", ""],
      ["C02:1795000020.000001", "Bob Kral", "unread"],
    ],
  );
  assert.deepEqual(kept[1], stored({}));
});

test("keeps stored messages, takes the newer copy of one, and drops those now covered or too old", () => {
  const earlier = stored({
    key: "C01:1795000005.000000",
    ts: "1795000005.000000",
    text: "earlier",
  });

  const kept = channelMessagesAfterSync({
    stored: [
      earlier,
      stored({ text: "Deploy is dnoe" }),
      stored({ key: "C01:1795000030.000000", ts: "1795000030.000000", text: "now on a card" }),
      stored({ key: "C01:1795000002.000000", ts: "1795000002.000000", text: "expired" }),
    ],
    hits: [hit({ text: "Deploy is done" })],
    me: ME,
    covered: new Set(["C01:1795000030.000000"]),
    readThrough: NOTHING_READ,
    keepFromTs: "1795000003",
  });

  assert.deepEqual(kept, [earlier, stored({})]);
});
