import { decodeEntities, slackTokens } from "./slack-text.js";

const MENTION_CODE = /<[@#!][^<>]*>/g;
const TYPED_MENTION_START = /<(?=[@#!])/g;
const MAX_QUERY_CHARS = 50;
const QUERY_BEFORE_CARET = new RegExp(
  `(?:^|\\s)([@#])((?:[^@#\\s][^@#\\n]{0,${MAX_QUERY_CHARS - 1}})?)$`,
);
const LABEL_BREAKERS = /[<>|]/g;
const WHITESPACE_START = /^\s/;
const COMBINING_MARKS = /\p{M}/gu;
const PERSON_ID = /^[UW]/;
const CHANNEL_ID = /^[CG]/;
const SPECIAL_MENTIONS = ["here", "channel", "everyone"];
const MAX_CHOICES = 8;

function displayOf(code, nameOf) {
  const tokens = slackTokens(code, nameOf);
  const [token] = tokens;
  return tokens.length === 1 && token.kind !== "text" ? token.text : code;
}

export function fieldFromSlack(slack, nameOf) {
  const marks = [];
  let text = "";
  let consumed = 0;
  for (const match of slack.matchAll(MENTION_CODE)) {
    text += decodeEntities(slack.slice(consumed, match.index));
    const display = displayOf(match[0], nameOf);
    marks.push({ start: text.length, end: text.length + display.length, code: match[0] });
    text += display;
    consumed = match.index + match[0].length;
  }
  return { text: text + decodeEntities(slack.slice(consumed)), marks };
}

function sharedStartLength(left, right, limit) {
  let length = 0;
  while (length < limit && left[length] === right[length]) length += 1;
  return length;
}

function sharedEndLength(left, right, limit) {
  let length = 0;
  while (length < limit && left[left.length - 1 - length] === right[right.length - 1 - length])
    length += 1;
  return length;
}

export function editedField(field, nextText, caret) {
  const previous = field.text;
  const unchangedEnd = sharedEndLength(
    previous,
    nextText,
    Math.max(0, Math.min(previous.length, nextText.length - caret)),
  );
  const unchangedStart = sharedStartLength(
    previous,
    nextText,
    Math.min(previous.length, nextText.length) - unchangedEnd,
  );
  const changedEnd = previous.length - unchangedEnd;
  const shift = nextText.length - previous.length;
  const marks = field.marks.flatMap((mark) => {
    if (mark.end <= unchangedStart) return [mark];
    if (mark.start >= changedEnd)
      return [{ ...mark, start: mark.start + shift, end: mark.end + shift }];
    return [];
  });
  return { text: nextText, marks };
}

export function mentionQuery(field, caret) {
  const match = QUERY_BEFORE_CARET.exec(field.text.slice(0, caret));
  if (match === null) return null;
  const [, trigger, query] = match;
  const start = caret - query.length - 1;
  if (field.marks.some((mark) => mark.start <= start && start < mark.end)) return null;
  return { trigger, start, query };
}

function codeOf(entry) {
  const label = entry.label.replace(LABEL_BREAKERS, "");
  if (entry.kind === "person") return `<@${entry.id}|${label}>`;
  if (entry.kind === "channel") return `<#${entry.id}|${label.replace(/^#/, "")}>`;
  return `<!${entry.id}>`;
}

export function entryText(entry) {
  if (entry.kind !== "channel") return `@${entry.label}`;
  return entry.label.startsWith("#") ? entry.label : `#${entry.label}`;
}

export function pickMention(field, query, caret, entry) {
  const display = entryText(entry);
  const after = field.text.slice(caret);
  const inserted = WHITESPACE_START.test(after) ? display : `${display} `;
  const shift = inserted.length - (caret - query.start);
  const mark = { start: query.start, end: query.start + display.length, code: codeOf(entry) };
  const marks = [
    ...field.marks.filter((existing) => existing.end <= query.start),
    mark,
    ...field.marks
      .filter((existing) => existing.start >= caret)
      .map((existing) => ({
        ...existing,
        start: existing.start + shift,
        end: existing.end + shift,
      })),
  ];
  return {
    field: { text: field.text.slice(0, query.start) + inserted + after, marks },
    caret: mark.end + 1,
  };
}

const folded = (text) => text.normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase();

const isChannelCard = (card) =>
  card.kind === "channel" || (card.kind === "compose" && CHANNEL_ID.test(card.target.channelId));

function participantsOf(card) {
  const mine = new Set(
    card.conversation.filter((message) => message.isMine).map(({ authorId }) => authorId),
  );
  return [...card.messages, ...card.conversation]
    .filter(({ authorId }) => authorId !== null && PERSON_ID.test(authorId) && !mine.has(authorId))
    .sort((left, right) => Number(right.ts) - Number(left.ts))
    .map((message) => ({ kind: "person", id: message.authorId, label: message.authorName }));
}

const entryOf = (recipient) => ({
  kind: recipient.kind,
  id: recipient.channelId,
  label: recipient.label,
});

function candidates({ trigger, query, card, people, found }) {
  const saved = [...people, ...found].map(entryOf);
  if (trigger === "#") return saved.filter((entry) => entry.kind === "channel");
  const specials = isChannelCard(card)
    ? SPECIAL_MENTIONS.filter((name) => name.startsWith(query.toLowerCase())).map((name) => ({
        kind: "special",
        id: name,
        label: name,
      }))
    : [];
  return [
    ...participantsOf(card).filter((entry) => folded(entry.label).includes(folded(query))),
    ...specials,
    ...saved.filter((entry) => entry.kind === "person"),
  ];
}

export function mentionChoices(input) {
  const unique = new Map();
  for (const entry of candidates(input)) if (!unique.has(entry.id)) unique.set(entry.id, entry);
  return [...unique.values()].slice(0, MAX_CHOICES);
}

export function mentionSummary(field) {
  const shown = field.marks.map((mark) => field.text.slice(mark.start, mark.end));
  const startingWith = (prefix) => [...new Set(shown.filter((text) => text.startsWith(prefix)))];
  return [
    ["Notifies", startingWith("@")],
    ["Links", startingWith("#")],
  ]
    .filter(([, names]) => names.length > 0)
    .map(([label, names]) => `${label} ${names.join(", ")}`)
    .join(" · ");
}

const plainSlack = (text) => text.replace(TYPED_MENTION_START, "&lt;");

export function slackFromField({ text, marks }) {
  let slack = "";
  let consumed = 0;
  for (const mark of marks) {
    slack += plainSlack(text.slice(consumed, mark.start)) + mark.code;
    consumed = mark.end;
  }
  return slack + plainSlack(text.slice(consumed));
}
