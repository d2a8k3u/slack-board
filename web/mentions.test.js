import assert from "node:assert/strict";
import { test } from "node:test";
import {
  editedField,
  fieldFromSlack,
  mentionChoices,
  mentionQuery,
  mentionSummary,
  pickMention,
  slackFromField,
} from "./mentions.js";

const nameOf = (id) => (id === "U0BOB" ? "Bob Kral" : null);

test("shows Slack mentions and channel links by name, each as one picked entry", () => {
  const slack = "tell <@U0ANA|Ana Novak> &amp; <@U0BOB> in <#C0DEV|dev>, <!here>";

  assert.deepEqual(fieldFromSlack(slack, nameOf), {
    text: "tell @Ana Novak & @Bob Kral in #dev, @here",
    marks: [
      { start: 5, end: 15, code: "<@U0ANA|Ana Novak>" },
      { start: 18, end: 27, code: "<@U0BOB>" },
      { start: 31, end: 35, code: "<#C0DEV|dev>" },
      { start: 37, end: 42, code: "<!here>" },
    ],
  });
});

test("keeps a picked entry while edits stay outside it, and turns it into plain text once touched", () => {
  const ana = (start) => ({ start, end: start + 4, code: "<@U0ANA|Ana>" });
  const cases = [
    ["typing after it", { text: "hi @Ana", marks: [ana(3)] }, "hi @Ana!", 8, [ana(3)]],
    ["typing before it", { text: "@Ana", marks: [ana(0)] }, "x @Ana", 2, [ana(2)]],
    [
      "typing its first letter before it",
      { text: "x @Ana", marks: [ana(2)] },
      "x @@Ana",
      3,
      [ana(3)],
    ],
    ["typing inside it", { text: "@Ana", marks: [ana(0)] }, "@Anna", 3, []],
    ["deleting its last letter", { text: "@Ana x", marks: [ana(0)] }, "@An x", 3, []],
  ];

  for (const [name, field, next, caret, marks] of cases)
    assert.deepEqual(editedField(field, next, caret), { text: next, marks }, name);
});

test("opens a search for @ or # at the start of a word, up to the caret", () => {
  const picked = { text: "@Ana Novak ", marks: [{ start: 0, end: 10, code: "<@U0ANA>" }] };
  const plain = (text) => ({ text, marks: [] });
  const cases = [
    ["@ alone", plain("@"), 1, { trigger: "@", start: 0, query: "" }],
    ["# after a word", plain("see #de"), 7, { trigger: "#", start: 4, query: "de" }],
    ["a name with a space", plain("hi @Ana N"), 9, { trigger: "@", start: 3, query: "Ana N" }],
    ["the caret before the end", plain("@an more"), 3, { trigger: "@", start: 0, query: "an" }],
    ["an email address", plain("mail a@b"), 8, null],
    ["a space right after @", plain("@ x"), 3, null],
    ["a new line", plain("@an\nx"), 5, null],
    ["right after a picked entry", picked, 11, null],
    [
      "the longest query",
      plain(`@${"a".repeat(50)}`),
      51,
      { trigger: "@", start: 0, query: "a".repeat(50) },
    ],
    ["a longer query", plain(`@${"a".repeat(51)}`), 52, null],
  ];

  for (const [name, field, caret, expected] of cases)
    assert.deepEqual(mentionQuery(field, caret), expected, name);
});

test("puts the picked entry in place of the search, as one entry followed by a space", () => {
  const ops = (start) => ({ start, end: start + 4, code: "<#C0OPS|ops>" });
  const query = { trigger: "@", start: 3, query: "an" };
  const before = { text: "hi @an #ops", marks: [ops(7)] };
  const cases = [
    [
      { kind: "person", id: "U0ANA", label: "Ana <Novak>|x" },
      before,
      {
        text: "hi @Ana <Novak>|x #ops",
        marks: [{ start: 3, end: 17, code: "<@U0ANA|Ana Novakx>" }, ops(18)],
      },
      18,
    ],
    [
      { kind: "channel", id: "C0DEV", label: "#dev" },
      before,
      { text: "hi #dev #ops", marks: [{ start: 3, end: 7, code: "<#C0DEV|dev>" }, ops(8)] },
      8,
    ],
    [
      { kind: "special", id: "here", label: "here" },
      { text: "hi @an", marks: [] },
      { text: "hi @here ", marks: [{ start: 3, end: 8, code: "<!here>" }] },
      9,
    ],
  ];

  for (const [entry, field, expected, caret] of cases)
    assert.deepEqual(pickMention(field, query, 6, entry), { field: expected, caret }, entry.kind);
});

test("offers people in this conversation first, then saved people, then Slack's matches, and channels for #", () => {
  const said = (authorId, authorName, ts, isMine = false) => ({ authorId, authorName, ts, isMine });
  const channelCard = {
    kind: "channel",
    target: { channelId: "C0GEN", threadTs: "1.0" },
    messages: [],
    conversation: [
      said("U0BOB", "Bob Král", "1.0"),
      said("U0ME", "Me Kralik", "2.0", true),
      said("U0ANA", "Ana Novak", "3.0"),
    ],
  };
  const dmCard = { ...channelCard, kind: "dm", target: { channelId: "D0BOB", threadTs: null } };
  const person = (channelId, label) => ({ channelId, label, kind: "person" });
  const channel = (channelId, label) => ({ channelId, label, kind: "channel" });
  const many = Array.from({ length: 10 }, (_, index) => person(`U0E${index}`, `Eva ${index}`));
  const ids = (input) => mentionChoices(input).map((entry) => entry.id);
  const cases = [
    [
      "people by name, accents ignored",
      {
        trigger: "@",
        query: "kral",
        card: channelCard,
        people: [person("U0BOB", "Bob Král"), person("U0EVA", "Eva Kralova")],
        found: [person("U0KAR", "Karel Kral"), channel("C0KRL", "#kral")],
      },
      ["U0BOB", "U0EVA", "U0KAR"],
    ],
    [
      "everyone in a channel",
      { trigger: "@", query: "e", card: channelCard, people: [], found: [] },
      ["everyone"],
    ],
    ["no everyone in a DM", { trigger: "@", query: "e", card: dmCard, people: [], found: [] }, []],
    [
      "the newest speaker first, at most eight",
      { trigger: "@", query: "", card: dmCard, people: many, found: [] },
      ["U0ANA", "U0BOB", "U0E0", "U0E1", "U0E2", "U0E3", "U0E4", "U0E5"],
    ],
    [
      "channels for #",
      {
        trigger: "#",
        query: "dev",
        card: channelCard,
        people: [channel("C0DEV", "#dev")],
        found: [person("U0DEV", "Dev Bot"), channel("C0DOPS", "#dev-ops")],
      },
      ["C0DEV", "C0DOPS"],
    ],
  ];

  for (const [name, input, expected] of cases) assert.deepEqual(ids(input), expected, name);
});

test("says who a note notifies and which channels it links", () => {
  const field = fieldFromSlack("<@U0ANA|Ana> <#C0DEV|dev> <!here> <@U0ANA|Ana> @plain", nameOf);

  assert.equal(mentionSummary(field), "Notifies @Ana, @here · Links #dev");
  assert.equal(mentionSummary({ text: "@plain", marks: [] }), "");
});

test("sends picked entries as Slack mentions and typed mention syntax as plain text", () => {
  const field = fieldFromSlack("hi <@U0ANA|Ana Novak>, see <https://x.io|docs>", nameOf);

  assert.equal(
    slackFromField({ ...field, text: `${field.text} <@U0BOB> <#C0DEV> <!here> a < b` }),
    "hi <@U0ANA|Ana Novak>, see <https://x.io|docs> &lt;@U0BOB> &lt;#C0DEV> &lt;!here> a < b",
  );
});
