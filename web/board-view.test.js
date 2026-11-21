import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activeFilters,
  excerptRanges,
  groupCards,
  highlightParts,
  matchesFilters,
  searchCards,
} from "./board-view.js";

const NO_FILTERS = { type: "all", channel: "any", person: "any", priority: "any" };

function card(key, overrides = {}) {
  const { authors = ["Ana Novak"], texts = ["hello"], threadTs, ...rest } = overrides;
  const messages = texts.map((text, index) => ({
    ts: `${100 + index}.000100`,
    authorId: null,
    authorName: authors[index] ?? authors.at(-1),
    text,
    permalink: null,
  }));
  return {
    key,
    kind: "dm",
    title: key,
    target: { channelId: "C1", threadTs: threadTs === undefined ? null : threadTs },
    messages,
    tickets: [],
    proposal: null,
    pending: null,
    error: null,
    priority: null,
    priorityReason: null,
    ...rest,
  };
}

const sectionsOf = (sections) =>
  sections.map((section) => [section.label, section.cards.map((entry) => entry.key)]);

test("groups cards into sections in the fixed order of each mode, keeping the given order inside and leaving empty sections out", () => {
  const mention = card("#ops", {
    kind: "channel",
    threadTs: "100.000100",
    authors: ["Cy Fenwick"],
    priority: "action",
  });
  const thread = card("#dev", {
    kind: "channel",
    threadTs: "50.000000",
    authors: ["Bo Lind"],
    priority: "decision",
    error: "boom",
  });
  const group = card("Ana, Bo", {
    kind: "group",
    authors: ["Bo Lind"],
    priority: "social",
    pending: { kind: "execute", status: "working" },
  });
  const dm = card("Ana Novak", { priority: "decision", proposal: { summary: "s", steps: [] } });
  const compose = card("Eli Brook", {
    kind: "compose",
    texts: [],
    pending: { kind: "propose", status: "pending" },
  });
  const cards = [mention, thread, group, dm, compose];
  const cases = [
    ["none", [["All", ["#ops", "#dev", "Ana, Bo", "Ana Novak", "Eli Brook"]]]],
    [
      "priority",
      [
        ["Decision", ["#dev", "Ana Novak"]],
        ["Action", ["#ops"]],
        ["Small talk", ["Ana, Bo"]],
        ["Not ranked yet", ["Eli Brook"]],
      ],
    ],
    [
      "type",
      [
        ["DMs", ["Ana, Bo", "Ana Novak"]],
        ["Mentions", ["#ops"]],
        ["Threads", ["#dev"]],
        ["New messages", ["Eli Brook"]],
      ],
    ],
    [
      "channel",
      [
        ["#dev", ["#dev"]],
        ["#ops", ["#ops"]],
        ["Direct and group messages", ["Ana, Bo", "Ana Novak", "Eli Brook"]],
      ],
    ],
    [
      "person",
      [
        ["Ana Novak", ["Ana Novak"]],
        ["Bo Lind", ["#dev", "Ana, Bo"]],
        ["Cy Fenwick", ["#ops"]],
        ["Eli Brook", ["Eli Brook"]],
      ],
    ],
    [
      "status",
      [
        ["Proposal ready", ["Ana Novak"]],
        ["Failed", ["#dev"]],
        ["Drafting", ["Eli Brook"]],
        ["Sending", ["Ana, Bo"]],
        ["New", ["#ops"]],
      ],
    ],
  ];
  for (const [mode, expected] of cases)
    assert.deepEqual(sectionsOf(groupCards(cards, mode)), expected, mode);
});

test("shows a card whose prompt Claude is working on as working, not as drafting a reply", () => {
  const working = card("Ana Novak", { pending: { kind: "act", status: "working" } });

  assert.deepEqual(sectionsOf(groupCards([working], "status")), [["Working", ["Ana Novak"]]]);
});

test("gives every section a key that stays the same while its cards change, so a collapsed section stays collapsed", () => {
  const first = groupCards([card("a", { priority: "info" })], "priority");
  const later = groupCards(
    [card("b", { priority: "info" }), card("c", { priority: "info" })],
    "priority",
  );
  assert.equal(first[0].key, later[0].key);
  assert.notEqual(groupCards([card("a", { priority: null })], "priority")[0].key, first[0].key);
});

test("keeps a card only when it passes every filter that is set", () => {
  const ticketThread = card("#dev", {
    kind: "channel",
    threadTs: "1.0",
    authors: ["Bo Lind"],
    priority: "info",
    tickets: [{ key: "DEMO-1", details: null }],
  });
  const group = card("Ana, Bo", {
    kind: "group",
    authors: ["Ana Novak", "Bo Lind"],
    texts: ["a", "b"],
    priority: "decision",
  });
  const cases = [
    [{ type: "dm" }, [false, true]],
    [{ type: "thread" }, [true, false]],
    [{ type: "ticket" }, [true, false]],
    [{ channel: "direct" }, [false, true]],
    [{ channel: "#dev" }, [true, false]],
    [{ person: "Ana Novak" }, [false, true]],
    [{ priority: "info" }, [true, false]],
    [{ person: "Bo Lind", priority: "decision" }, [false, true]],
    [{ person: "Bo Lind", channel: "#dev", priority: "decision" }, [false, false]],
  ];
  for (const [set, expected] of cases) {
    const filters = { ...NO_FILTERS, ...set };
    assert.deepEqual(
      [ticketThread, group].map((candidate) => matchesFilters(candidate, filters)),
      expected,
      JSON.stringify(set),
    );
  }
});

test("describes each filter that is set as a removable chip label", () => {
  assert.deepEqual(activeFilters(NO_FILTERS), []);
  assert.deepEqual(
    activeFilters({ type: "dm", channel: "#dev", person: "Bo Lind", priority: "social" }),
    [
      { name: "type", label: "Type: DMs" },
      { name: "channel", label: "Channel: #dev" },
      { name: "person", label: "Person: Bo Lind" },
      { name: "priority", label: "Priority: Small talk" },
    ],
  );
  assert.deepEqual(activeFilters({ ...NO_FILTERS, channel: "direct" }), [
    { name: "channel", label: "Channel: Direct and group messages" },
  ]);
});

test("finds a card despite a typo and ranks a title match above a match in message text", () => {
  const backend = card("#backend", { kind: "channel", texts: ["deploy went fine"] });
  const mentions = card("Ana Novak", { texts: ["the backend sync retried"] });
  const unrelated = card("Leo Brandt", { texts: ["lunch tomorrow"] });
  assert.deepEqual(
    searchCards([unrelated, mentions, backend], "bacnked").map((hit) => hit.card.key),
    ["#backend", "Ana Novak"],
  );
});

test("searches authors, ticket keys and titles, the place and the priority reason", () => {
  const cards = [
    card("one", { authors: ["Priya Nair"] }),
    card("two", { tickets: [{ key: "DEMO-77", details: { title: "Checkout totals wrong" } }] }),
    card("three", { priorityReason: "Wants your review on a PR" }),
    card("four", { kind: "group" }),
  ];
  const keysFor = (query) => searchCards(cards, query).map((hit) => hit.card.key);
  assert.deepEqual(keysFor("priya"), ["one"]);
  assert.deepEqual(keysFor("DEMO-77"), ["two"]);
  assert.deepEqual(keysFor("checkout"), ["two"]);
  assert.deepEqual(keysFor("review"), ["three"]);
  assert.deepEqual(keysFor("group message"), ["four"]);
});

test("returns every matching card, not only the first page", () => {
  const cards = Array.from({ length: 45 }, (_, index) =>
    card(`card-${index}`, { texts: ["release notes"] }),
  );
  assert.equal(searchCards(cards, "release").length, 45);
});

test("searches with the start of a pasted query that is too long or has too many words instead of failing", () => {
  const cards = [card("#backend", { kind: "channel" })];
  assert.equal(searchCards(cards, "backend ".repeat(40)).length, 1);
  assert.equal(searchCards(cards, "backend ".repeat(20)).length, 1);
});

test("searches the plain text of a message, not its Slack markup", () => {
  const linked = card("a", { texts: ["see <https://example.com/x|the spec>"] });
  const plain = (text) => text.replace(/<https?:[^|>]+\|([^>]+)>/g, "$1");
  assert.deepEqual(searchCards([linked], "example", plain), []);
  assert.equal(searchCards([linked], "spec", plain).length, 1);
});

test("highlights the excerpt with the match ranges of the latest message, otherwise with the query words it contains", () => {
  const target = card("#backend", {
    kind: "channel",
    texts: ["older backend note", "Retry backoff is wrong"],
  });
  const [inLatest] = searchCards([target], "backoff");
  assert.deepEqual(excerptRanges(target, inLatest.matches, "backoff"), [[6, 13]]);
  const [inTitleAndOlder] = searchCards([target], "backend");
  assert.deepEqual(excerptRanges(target, inTitleAndOlder.matches, "backend wrong"), [[17, 22]]);
  assert.deepEqual(excerptRanges(card("empty", { texts: [] }), [], "x"), []);
});

test("splits text into marked and plain parts, merging ranges that touch or overlap", () => {
  assert.deepEqual(
    highlightParts("backend sync", [
      [0, 4],
      [3, 7],
      [8, 12],
    ]),
    [
      { text: "backend", match: true },
      { text: " ", match: false },
      { text: "sync", match: true },
    ],
  );
  assert.deepEqual(highlightParts("plain", []), [{ text: "plain", match: false }]);
});
