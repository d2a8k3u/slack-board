import { search } from "./vendor/typoseek/index.mjs";

export const ANY = "any";
export const DIRECT = "direct";
export const ALL_TYPES = "all";
export const NO_GROUP = "none";
export const GROUP_MODES = [NO_GROUP, "priority", "type", "channel", "person", "status"];

export const PRIORITIES = {
  decision: { label: "Decision", rank: 4 },
  action: { label: "Action", rank: 3 },
  info: { label: "Info", rank: 2 },
  social: { label: "Small talk", rank: 1 },
};

export const STATUSES = {
  proposal: { label: "Proposal ready", rank: 4 },
  failed: { label: "Failed", rank: 3 },
  drafting: { label: "Drafting", rank: 2 },
  sending: { label: "Sending", rank: 2 },
  new: { label: "New", rank: 1 },
};

export const TYPE_LABELS = {
  [ALL_TYPES]: "All",
  dm: "DMs",
  mention: "Mentions",
  thread: "Threads",
  ticket: "Tickets",
};
export const DIRECT_LABEL = "Direct and group messages";

const PLACE_LABELS = { dm: "Direct message", group: "Group message", compose: "New message" };
const STATUS_ORDER = ["proposal", "failed", "drafting", "sending", "new"];
const TYPE_SECTIONS = [
  { type: "dm", label: "DMs" },
  { type: "mention", label: "Mentions" },
  { type: "thread", label: "Threads" },
  { type: null, label: "New messages" },
];
const UNRANKED_SECTION = { key: "unranked", label: "Not ranked yet", tone: "unranked" };
const ALL_SECTION = { key: "all", label: "All", order: 0, tone: "none" };
const SEARCH_RESULT_LIMIT = 1000;
const SEARCH_TYPOS = { minLengthForOne: 4, minLengthForTwo: 7 };
const SEARCH_KEYS = [
  { path: "title", weight: 3 },
  { path: "authors", weight: 2 },
  { path: "ticketKeys", weight: 2 },
  { path: "texts", weight: 1 },
  { path: "ticketTitles", weight: 1 },
  { path: "place", weight: 1 },
  { path: "reason", weight: 1 },
];
const QUERY_WORDS = /\S+/g;
const REGEXP_SPECIALS = /[.*+?^${}()|[\]\\]/g;

const sameText = (text) => text;

export const latestMessage = (card) => card.messages.at(-1);

export function typeOf(card) {
  if (card.kind === "dm" || card.kind === "group") return "dm";
  if (card.kind !== "channel") return null;
  return card.target.threadTs === card.messages[0]?.ts ? "mention" : "thread";
}

export function statusOf(card) {
  if (card.pending?.kind === "propose") return "drafting";
  if (card.pending?.kind === "execute") return "sending";
  if (card.proposal !== null) return "proposal";
  if (card.error !== null) return "failed";
  return "new";
}

export const personOf = (card) => latestMessage(card)?.authorName ?? card.title;

export function placeOf(card) {
  if (card.kind !== "channel") return PLACE_LABELS[card.kind] ?? card.kind;
  const kindLabel = typeOf(card) === "mention" ? "Mention" : "Thread";
  const author = latestMessage(card)?.authorName;
  return author === undefined ? kindLabel : `${kindLabel} · ${author}`;
}

function matchesType(card, type) {
  if (type === ALL_TYPES) return true;
  if (type === "ticket") return card.tickets.length > 0;
  return typeOf(card) === type;
}

function matchesChannel(card, channel) {
  if (channel === ANY) return true;
  if (channel === DIRECT) return card.kind === "dm" || card.kind === "group";
  return card.kind === "channel" && card.title === channel;
}

export function matchesFilters(card, filters) {
  return (
    matchesType(card, filters.type) &&
    matchesChannel(card, filters.channel) &&
    (filters.person === ANY ||
      card.messages.some((message) => message.authorName === filters.person)) &&
    (filters.priority === ANY || card.priority === filters.priority)
  );
}

export function activeFilters(filters) {
  const chips = [];
  if (filters.type !== ALL_TYPES)
    chips.push({ name: "type", label: `Type: ${TYPE_LABELS[filters.type] ?? filters.type}` });
  if (filters.channel !== ANY)
    chips.push({
      name: "channel",
      label: `Channel: ${filters.channel === DIRECT ? DIRECT_LABEL : filters.channel}`,
    });
  if (filters.person !== ANY) chips.push({ name: "person", label: `Person: ${filters.person}` });
  if (filters.priority !== ANY)
    chips.push({
      name: "priority",
      label: `Priority: ${PRIORITIES[filters.priority]?.label ?? filters.priority}`,
    });
  return chips;
}

const SECTION_OF = {
  none: () => ALL_SECTION,
  priority: (card) => {
    const priority = PRIORITIES[card.priority];
    if (priority === undefined) return { ...UNRANKED_SECTION, order: 0 };
    return {
      key: card.priority,
      label: priority.label,
      order: -priority.rank,
      tone: card.priority,
    };
  },
  type: (card) => {
    const order = TYPE_SECTIONS.findIndex((section) => section.type === typeOf(card));
    return {
      key: `type:${TYPE_SECTIONS[order].type ?? "compose"}`,
      label: TYPE_SECTIONS[order].label,
      order,
      tone: "muted",
    };
  },
  channel: (card) =>
    card.kind === "channel"
      ? { key: `channel:${card.title}`, label: card.title, order: 0, tone: "muted" }
      : { key: DIRECT, label: DIRECT_LABEL, order: 1, tone: "muted" },
  person: (card) => {
    const name = personOf(card);
    return { key: `person:${name}`, label: name, order: 0, tone: "muted" };
  },
  status: (card) => {
    const status = statusOf(card);
    return {
      key: status,
      label: STATUSES[status].label,
      order: STATUS_ORDER.indexOf(status),
      tone: status,
    };
  },
};

export function groupCards(cards, mode) {
  const sectionOf = SECTION_OF[mode] ?? SECTION_OF[NO_GROUP];
  const sections = new Map();
  for (const card of cards) {
    const section = sectionOf(card);
    const bucket = sections.get(section.key) ?? { ...section, cards: [] };
    bucket.cards.push(card);
    sections.set(section.key, bucket);
  }
  return [...sections.values()]
    .sort((left, right) => left.order - right.order || left.label.localeCompare(right.label))
    .map(({ key, label, tone, cards: sectionCards }) => ({
      key,
      label,
      tone,
      cards: sectionCards,
    }));
}

function searchRecord(card, textOf) {
  return {
    title: card.title,
    authors: card.messages.map((message) => message.authorName),
    ticketKeys: card.tickets.map((ticket) => ticket.key),
    texts: card.messages.map((message) => textOf(message.text)),
    ticketTitles: card.tickets
      .map((ticket) => ticket.details?.title)
      .filter((title) => typeof title === "string"),
    place: placeOf(card),
    reason: card.priorityReason ?? "",
  };
}

export function searchCards(cards, query, textOf = sameText) {
  const records = cards.map((card) => searchRecord(card, textOf));
  const { hits } = search(records, query, {
    keys: SEARCH_KEYS,
    limit: SEARCH_RESULT_LIMIT,
    typos: SEARCH_TYPOS,
    truncateQuery: true,
  });
  return hits.map((hit) => ({ card: cards[hit.refIndex], matches: hit.matches }));
}

export function titleRanges(matches) {
  return matches.filter((match) => match.key === "title").flatMap((match) => match.ranges);
}

function queryWordRanges(text, query) {
  const lower = text.toLowerCase();
  return (query.toLowerCase().match(QUERY_WORDS) ?? []).flatMap((word) =>
    [...lower.matchAll(new RegExp(word.replace(REGEXP_SPECIALS, "\\$&"), "g"))].map((found) => [
      found.index,
      found.index + word.length,
    ]),
  );
}

export function excerptRanges(card, matches, query, textOf = sameText) {
  const latestIndex = card.messages.length - 1;
  if (latestIndex < 0) return [];
  const inLatest = matches
    .filter((match) => match.key === "texts" && match.valueIndex === latestIndex)
    .flatMap((match) => match.ranges);
  return inLatest.length > 0
    ? inLatest
    : queryWordRanges(textOf(card.messages[latestIndex].text), query);
}

function mergedRanges(ranges) {
  const sorted = [...ranges].sort((left, right) => left[0] - right[0]);
  const merged = [];
  for (const [start, end] of sorted) {
    const last = merged.at(-1);
    if (last !== undefined && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

export function highlightParts(text, ranges) {
  const parts = [];
  let consumed = 0;
  for (const [start, end] of mergedRanges(ranges)) {
    if (start > consumed) parts.push({ text: text.slice(consumed, start), match: false });
    parts.push({ text: text.slice(start, end), match: true });
    consumed = end;
  }
  if (consumed < text.length || parts.length === 0)
    parts.push({ text: text.slice(consumed), match: false });
  return parts;
}
