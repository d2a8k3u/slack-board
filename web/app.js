import {
  ALL_TYPES,
  ANY,
  activeFilters,
  CONTROLS,
  cardChanges,
  DIRECT,
  DIRECT_LABEL,
  excerptRanges,
  GROUP_MODES,
  groupCards,
  highlightParts,
  isScrolledToEnd,
  latestMessage,
  matchesFilters,
  NO_GROUP,
  PRIORITIES,
  personOf,
  placeOf,
  STATUSES,
  searchCards,
  spinningControl,
  statusOf,
  TYPE_LABELS,
  titleRanges,
} from "./board-view.js";
import { mentionField } from "./mention-field.js";
import { mentionChoices } from "./mentions.js";
import { cardNotices, newsNotices, syncNotices } from "./notifications.js";
import { safeHref, slackTokens } from "./slack-text.js";

const TOKEN_STORAGE_KEY = "slack-board-token";
const THEME_STORAGE_KEY = "slack-board-theme";
const VIEW_STORAGE_KEY = "slack-board-view";
const OPENED_STORAGE_KEY = "slack-board-opened";
const GROUP_STORAGE_KEY = "slack-board-group";
const COLLAPSED_STORAGE_KEY = "slack-board-collapsed";
const SEARCH_SHORTCUT = "/";
const POLL_INTERVAL_MS = 2000;
const TOAST_MS = 8000;
const MAX_TOASTS = 4;
const ALL_NOTICES_ON = { newMessages: true, claudeDone: true, sendFailed: true, syncFailed: true };
const NOTIFY_LABELS = {
  default: "Turn on notifications",
  granted: "Notifications on",
  denied: "Notifications blocked",
};
const NOTIFY_HINTS = {
  default: "Turn on notifications to get them while the board is in the background",
  granted: "Notifications are on, also while the board is in the background",
  denied: "Notifications are blocked. Allow them for this page in your browser's site settings",
};
const NOTIFY_ICONS = { default: "bellQuestion", granted: "bell", denied: "bellOff" };
const NOTIFY_ICON_PX = 18;
const PEOPLE_DEBOUNCE_MS = 120;
const LOOKUP_DEBOUNCE_MS = 500;
const LOOKUP_MIN_CHARS = 2;
const SINGLE_WORD = /^\S+$/;
const TIME_REFRESH_MS = 30_000;
const ANNOUNCE_DELAY_MS = 60;
const MS_PER_SECOND = 1000;
const CARD_STAGGER_MS = 45;
const CARD_STAGGER_LIMIT = 12;
const MESSAGE_STAGGER_BASE_MS = 60;
const MESSAGE_STAGGER_MS = 50;
const RELATIVE_UNITS = [
  { limitSeconds: 60, sizeSeconds: 1, name: "second" },
  { limitSeconds: 3_600, sizeSeconds: 60, name: "minute" },
  { limitSeconds: 86_400, sizeSeconds: 3_600, name: "hour" },
  { limitSeconds: 604_800, sizeSeconds: 86_400, name: "day" },
];
const QUICK_REACTIONS = [":+1:", ":eyes:", ":white_check_mark:", ":pray:"];
const AVATAR_COLOURS = [
  "#F1E3DD",
  "#E3E8EF",
  "#E6EDE3",
  "#EFE6F1",
  "#F3EBD8",
  "#E0ECEA",
  "#F0E2E6",
];
const CHANNEL_AVATAR_COLOUR = "#F1EDEA";
const THEMES = ["system", "light", "dark"];
const VIEWS = ["tiles", "list"];
const TYPE_FILTERS = Object.entries(TYPE_LABELS).map(([id, label]) => ({ id, label }));
const NO_FILTERS = { type: ALL_TYPES, channel: ANY, person: ANY, priority: ANY };
const UNRANKED_PRIORITY = 0;
const DIRECT_CHANNEL_SORT_NAME = "Direct message";
const REGEXP_SPECIALS = /[.*+?^${}()|[\]\\]/g;
const NEW_TAB_HINT = " (opens in a new tab)";
const UNREACHABLE_MESSAGE =
  "The board server did not answer. Check that Claude Code is still running, then try again.";
const UNREADABLE_MESSAGE = "The board server sent an answer the board cannot read.";
const BUSY_MESSAGE = "Claude is still working on this card";
const EMPTY_COMPOSER_MESSAGE = "Write a reply, an emoji or an instruction first.";
const EMPTY_ACTION_MESSAGE = "Write a prompt first.";
const ACTIONS_INTRO =
  "Write a prompt the way you would in Claude Code. Claude works on it with this conversation and answers here.";
const RUNNING_STEPS_WORK = {
  title: "Sending.",
  text: " Claude is running the steps you approved.",
};
const HISTORY_ERROR_PREFIX = "Earlier messages could not be loaded from Slack: ";
const EMPTY_THREAD_MESSAGE = "Write your reply first.";
const NO_OTHER_MESSAGES = { total: 0, isMissing: false, channels: [] };
const OTHER_READ = "other-read";
const OTHER_LOADING_MESSAGE = "Loading messages…";
const OTHER_NO_TEXT_MESSAGE = "No text here. Open it in Slack to see it.";
const BELL_PATH = "M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0";
const ICON_SHAPES = {
  external: { width: 2, shapes: [["path", { d: "M14 5h5v5M19 5l-8 8M18 14v5H5V6h5" }]] },
  bolt: { width: 2, shapes: [["path", { d: "M13 3L5 14h6l-1 7 8-11h-6z" }]] },
  close: { width: 2.2, shapes: [["path", { d: "M6 6l12 12M18 6L6 18" }]] },
  summarize: {
    width: 2,
    shapes: [
      ["path", { d: "M4 6h16M4 12h10M4 18h7" }],
      ["path", { d: "M18 14l1 2 2 1-2 1-1 2-1-2-2-1 2-1z" }],
    ],
  },
  alert: {
    width: 2.2,
    shapes: [
      ["circle", { cx: "12", cy: "12", r: "9" }],
      ["path", { d: "M12 7v6M12 17h.01" }],
    ],
  },
  check: { width: 2.4, shapes: [["path", { d: "M5 12l5 5L20 7" }]] },
  send: { width: 2, shapes: [["path", { d: "M4 12l16-8-6 16-3-7z" }]] },
  spark: {
    width: 2.2,
    shapes: [
      [
        "path",
        {
          d: "M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8",
        },
      ],
    ],
  },
  chevron: { width: 2.4, shapes: [["path", { d: "M6 9l6 6 6-6" }]] },
  remove: { width: 3, shapes: [["path", { d: "M6 6l12 12M18 6L6 18" }]] },
  bell: { width: 2, shapes: [["path", { d: BELL_PATH }]] },
  bellOff: { width: 2, shapes: [["path", { d: `${BELL_PATH}M3 3l18 18` }]] },
  bellQuestion: {
    width: 2,
    shapes: [
      [
        "path",
        { d: `${BELL_PATH}M10.4 8.6a1.7 1.7 0 1 1 2.4 1.6c-.5.2-.8.6-.8 1.1v.3M12 14.2h.01` },
      ],
    ],
  },
};

const SORTS = {
  priority: {
    initial: "desc",
    directions: { desc: "Needs you first", asc: "Needs you last" },
    key: (card) => priorityRank(card),
  },
  time: {
    initial: "desc",
    directions: { desc: "Newest first", asc: "Oldest first" },
    key: (card) => latestSeconds(card),
  },
  status: {
    initial: "desc",
    directions: { desc: "Needs you first", asc: "Needs you last" },
    key: (card) => STATUSES[statusOf(card)].rank,
  },
  person: {
    initial: "asc",
    directions: { asc: "A to Z", desc: "Z to A" },
    key: (card) => personOf(card),
  },
  channel: {
    initial: "asc",
    directions: { asc: "A to Z", desc: "Z to A" },
    key: (card) => channelOf(card),
  },
  messages: {
    initial: "desc",
    directions: { desc: "Most first", asc: "Fewest first" },
    key: (card) => card.messages.length,
  },
};

const absoluteFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const fullFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeStyle: "short" });

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const byId = (id) => {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`index.html lacks #${id}`);
  return node;
};

const dom = {
  announcer: byId("announcer"),
  signedOut: byId("signed-out"),
  app: byId("app"),
  boardStatus: byId("board-status"),
  syncError: byId("sync-error"),
  connectionError: byId("connection-error"),
  syncButton: byId("sync-button"),
  syncButtonError: byId("sync-button-error"),
  notifyButton: byId("notify-button"),
  toasts: byId("toasts"),
  composeButton: byId("compose-button"),
  themeButtons: [...document.querySelectorAll("[data-theme-option]")],
  viewButtons: [...document.querySelectorAll("[data-view-option]")],
  listHeading: byId("list-heading"),
  visibleCount: byId("visible-count"),
  search: byId("board-search"),
  searchClear: byId("search-clear"),
  searchHint: byId("search-hint"),
  filtersButton: byId("filters-button"),
  filtersCount: byId("filters-count"),
  filtersPanel: byId("filters-panel"),
  filtersDone: byId("filters-done"),
  typeFilters: byId("type-filters"),
  channelSelect: byId("f-channel"),
  personSelect: byId("f-person"),
  prioritySelect: byId("f-priority"),
  clearFilters: byId("clear-filters"),
  groupSelect: byId("group-select"),
  sortSelect: byId("f-sort"),
  sortSelectWrap: byId("sort-select-wrap"),
  bestMatch: byId("best-match"),
  sortDirection: byId("sort-direction"),
  activeFiltersRow: byId("active-filters-row"),
  activeFilters: byId("active-filters"),
  clearAll: byId("clear-all"),
  listStatus: byId("list-status"),
  emptyState: byId("empty-state"),
  emptyClear: byId("empty-clear"),
  cardSections: byId("card-sections"),
  otherMessages: byId("other-messages"),
  otherToggle: byId("other-toggle"),
  otherCount: byId("other-count"),
  otherReadAll: byId("other-read-all"),
  otherMissing: byId("other-missing"),
  otherError: byId("other-error"),
  otherChannels: byId("other-channels"),
  detailDialog: byId("detail-dialog"),
  composeDialog: byId("compose-dialog"),
  composeClose: byId("compose-close"),
  composeQuery: byId("compose-query"),
  composeStatus: byId("compose-status"),
  composeError: byId("compose-error"),
  composeResults: byId("compose-results"),
};

const darkScheme = window.matchMedia("(prefers-color-scheme: dark)");

const scopeOf = (action, key) => `${action}:${key}`;
const cardPath = (key) => `/api/cards/${encodeURIComponent(key)}`;
const isObject = (value) => typeof value === "object" && value !== null;
const findCard = (key) => board.cards.find((card) => card.key === key);
const threadDraftKey = (cardKey, ts) => `${cardKey}\n${ts}`;

const board = {
  token: null,
  signedOut: false,
  loaded: false,
  cards: [],
  sync: { lastSyncAt: null, lastError: null, isRunning: false },
  news: null,
  otherMessages: NO_OTHER_MESSAGES,
  notify: ALL_NOTICES_ON,
  lookup: null,
  polish: true,
  connectionError: null,
  pollTimer: 0,
};

const ui = {
  theme: storedChoice(THEME_STORAGE_KEY, THEMES),
  view: storedChoice(VIEW_STORAGE_KEY, VIEWS),
  type: ALL_TYPES,
  channel: ANY,
  person: ANY,
  priority: ANY,
  query: "",
  group: storedChoice(GROUP_STORAGE_KEY, GROUP_MODES),
  collapsed: readCollapsed(),
  filtersOpen: false,
  sortBy: "priority",
  sortDir: SORTS.priority.initial,
  openKey: null,
  selectedKey: null,
  actionsOpen: false,
  replyToTs: null,
  pendingOpenKey: null,
  otherOpen: false,
  openChannels: new Set(),
};

const memory = {
  drafts: new Map(),
  actionDrafts: new Map(),
  threadDrafts: new Map(),
  notes: new Map(),
  edits: new Map(),
  actionEdits: new Map(),
  started: new Map(),
  opened: readOpened(),
};

const requests = { inFlight: new Set(), errors: new Map() };

const compose = {
  people: [],
  peopleQuery: null,
  peopleRequest: 0,
  peopleTimer: 0,
  lookupTimer: 0,
  lookupSignature: "",
  error: null,
};

const lookups = { requested: new Set() };

const mention = {
  searched: "",
  loaded: "",
  people: [],
  request: 0,
  peopleTimer: 0,
  lookupTimer: 0,
  error: null,
  refresh: null,
};

const cardNodes = new Map();
const sectionNodes = new Map();
const sectionSignatures = new WeakMap();
let detail = null;
let stateChain = Promise.resolve();
let renderQueued = false;
let sectionCounter = 0;

function readStorage(area, key) {
  try {
    return window[area].getItem(key);
  } catch (error) {
    if (!(error instanceof DOMException)) throw error;
    return null;
  }
}

function writeStorage(area, key, value) {
  try {
    if (value === null) window[area].removeItem(key);
    else window[area].setItem(key, value);
  } catch (error) {
    if (!(error instanceof DOMException)) throw error;
  }
}

function storedChoice(key, choices) {
  const stored = readStorage("localStorage", key);
  return choices.includes(stored) ? stored : choices[0];
}

function readOpened() {
  const raw = readStorage("localStorage", OPENED_STORAGE_KEY);
  if (raw === null) return new Map();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return new Map();
  }
  if (!isObject(parsed)) return new Map();
  return new Map(
    Object.entries(parsed).filter(
      ([, seconds]) => typeof seconds === "number" && Number.isFinite(seconds),
    ),
  );
}

function readCollapsed() {
  const raw = readStorage("localStorage", COLLAPSED_STORAGE_KEY);
  if (raw === null) return new Set();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return new Set();
  }
  return new Set(Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === "string") : []);
}

function writeCollapsed() {
  writeStorage("localStorage", COLLAPSED_STORAGE_KEY, JSON.stringify([...ui.collapsed]));
}

function writeOpened() {
  writeStorage(
    "localStorage",
    OPENED_STORAGE_KEY,
    JSON.stringify(Object.fromEntries(memory.opened)),
  );
}

function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === "text") node.textContent = value;
    else if (name.startsWith("on") && typeof value === "function")
      node.addEventListener(name.slice(2), value);
    else node.setAttribute(name, value === true ? "" : String(value));
  }
  node.append(
    ...children.filter((child) => child !== null && child !== undefined && child !== false),
  );
  return node;
}

function icon(name, size = 16) {
  const { width, shapes } = ICON_SHAPES[name];
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const attributes = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": width,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
    class: "sb-icon",
  };
  for (const [attribute, value] of Object.entries(attributes))
    svg.setAttribute(attribute, String(value));
  for (const [tag, shapeAttributes] of shapes) {
    const shape = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [attribute, value] of Object.entries(shapeAttributes))
      shape.setAttribute(attribute, value);
    svg.append(shape);
  }
  return svg;
}

function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

function setDisabled(button, disabled) {
  button.setAttribute("aria-disabled", disabled ? "true" : "false");
}

function setBusy(button, busy) {
  button.setAttribute("aria-busy", busy ? "true" : "false");
}

function spinOnly(buttonsByControl, spinning) {
  const spinner = spinning === null ? undefined : buttonsByControl.get(spinning);
  for (const button of new Set(buttonsByControl.values())) setBusy(button, button === spinner);
}

const reactionControl = (reaction) => `reaction:${reaction}`;
const threadControl = (control, ts) => `${control}:${ts}`;

function startWork(key, control, kind, scope) {
  memory.started.set(key, { control, kind, scope });
}

function spinningControlOf(card) {
  const started = memory.started.get(card.key);
  const isRequestInFlight = started !== undefined && requests.inFlight.has(started.scope);
  return spinningControl(card, isRequestInFlight, started);
}

const isDisabled = (button) => button.getAttribute("aria-disabled") === "true";

const isTextField = (node) =>
  node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement;

function focusByKey(container, focusKey) {
  const target = [...container.querySelectorAll("[data-focus-key]")].find(
    (node) => node.dataset.focusKey === focusKey,
  );
  target?.focus();
  return target !== undefined && document.activeElement === target;
}

function syncSection(container, signature, build) {
  if (sectionSignatures.get(container) === signature) return;
  const active = document.activeElement;
  const focusInside = active instanceof HTMLElement && container.contains(active);
  if (focusInside && isTextField(active)) return;
  sectionSignatures.set(container, signature);
  const focusKey = focusInside ? active.dataset.focusKey : undefined;
  container.replaceChildren(...build());
  if (focusKey !== undefined) focusByKey(container, focusKey);
}

function errorLine(extraClass = "", text = "") {
  return el("p", { class: `field-error ${extraClass}`.trim(), role: "alert", text });
}

function announce(messages) {
  const text = messages.join(" ");
  if (text === "") return;
  dom.announcer.textContent = "";
  setTimeout(() => {
    dom.announcer.textContent = text;
  }, ANNOUNCE_DELAY_MS);
}

function slackSeconds(ts) {
  const seconds = Number.parseFloat(ts);
  return Number.isFinite(seconds) ? seconds : null;
}

function isoSeconds(iso) {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms / MS_PER_SECOND;
}

function relativeLabel(seconds, nowMs) {
  const elapsed = Math.max(0, nowMs / MS_PER_SECOND - seconds);
  const unit = RELATIVE_UNITS.find((candidate) => elapsed < candidate.limitSeconds);
  if (unit === undefined) return absoluteFormat.format(new Date(seconds * MS_PER_SECOND));
  const count = Math.max(1, Math.floor(elapsed / unit.sizeSeconds));
  return `${count} ${unit.name}${count === 1 ? "" : "s"} ago`;
}

function timeNode(seconds, className) {
  if (seconds === null) return null;
  const date = new Date(seconds * MS_PER_SECOND);
  return el("time", {
    class: className,
    datetime: date.toISOString(),
    title: fullFormat.format(date),
    "data-seconds": String(seconds),
    text: relativeLabel(seconds, Date.now()),
  });
}

function refreshTimes() {
  const nowMs = Date.now();
  for (const node of document.querySelectorAll("time[data-seconds]"))
    setText(node, relativeLabel(Number(node.dataset.seconds), nowMs));
}

function knownName(userId) {
  for (const card of board.cards) {
    const message = card.messages.find((candidate) => candidate.authorId === userId);
    if (message !== undefined) return message.authorName;
  }
  return null;
}

const plainText = (text) =>
  slackTokens(text, knownName)
    .map((token) => token.text)
    .join("");

function ticketPattern(keys) {
  if (keys.length === 0) return null;
  const alternatives = [...keys]
    .sort((left, right) => right.length - left.length)
    .map((key) => key.replace(REGEXP_SPECIALS, "\\$&"));
  return new RegExp(`\\b(${alternatives.join("|")})\\b`);
}

function splitTickets(text, pattern) {
  if (pattern === null) return [{ kind: "text", text }];
  return text
    .split(pattern)
    .map((part, index) => ({ kind: index % 2 === 1 ? "ticket" : "text", text: part }))
    .filter((part) => part.text !== "");
}

function messageSegments(text, pattern) {
  return slackTokens(text, knownName).flatMap((token) =>
    token.kind === "text" ? splitTickets(token.text, pattern) : [token],
  );
}

function mentionButton(text, recipient) {
  return el(
    "button",
    {
      type: "button",
      class: "mention",
      title: `New message to ${recipient.label}`,
      onclick: () => void chooseRecipient(recipient),
    },
    text,
  );
}

function segmentNode(segment) {
  if (segment.kind === "link") return externalLink(segment.href, segment.text);
  if (segment.kind === "mention")
    return mentionButton(segment.text, { channelId: segment.userId, label: segment.text.slice(1) });
  if (segment.kind === "channel")
    return mentionButton(segment.text, { channelId: segment.channelId, label: segment.text });
  if (segment.kind === "special")
    return el("span", { class: "mention mention--plain", text: segment.text });
  if (segment.kind === "ticket") return el("span", { class: "ticket-inline", text: segment.text });
  return document.createTextNode(segment.text);
}

function externalLink(href, label, extraClass = "") {
  return el(
    "a",
    { href, target: "_blank", rel: "noreferrer noopener", class: extraClass || null },
    label,
    el("span", { class: "sr-only", text: NEW_TAB_HINT }),
  );
}

function boardTicketKeys() {
  return [...new Set(board.cards.flatMap((card) => card.tickets.map((ticket) => ticket.key)))];
}

function initialsOf(name) {
  const words = name
    .split(/[\s,]+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+/u, ""))
    .filter((word) => word !== "");
  const initials = words
    .slice(0, 2)
    .map((word) => Array.from(word)[0].toUpperCase())
    .join("");
  return initials === "" ? "?" : initials;
}

function avatarColour(name) {
  const hash = Array.from(name).reduce(
    (sum, character) => (sum * 31 + character.codePointAt(0)) >>> 0,
    0,
  );
  return AVATAR_COLOURS[hash % AVATAR_COLOURS.length];
}

function avatarName(card) {
  if (!card.title.startsWith("#")) return card.title;
  return latestMessage(card)?.authorName ?? card.title;
}

function avatar(name, sizeClass) {
  const node = el("span", {
    class: `avatar ${sizeClass}`,
    "aria-hidden": "true",
    text: initialsOf(name),
  });
  node.style.backgroundColor = avatarColour(name);
  return node;
}

function latestSeconds(card) {
  const message = latestMessage(card);
  const seconds = message === undefined ? null : slackSeconds(message.ts);
  return seconds ?? isoSeconds(card.updatedAt) ?? 0;
}

function priorityRank(card) {
  return PRIORITIES[card.priority]?.rank ?? UNRANKED_PRIORITY;
}

function priorityBadge(priority, reason) {
  if (PRIORITIES[priority] === undefined) return null;
  return el("span", {
    class: `priority priority--${priority}`,
    title: reason,
    text: PRIORITIES[priority].label,
  });
}

const channelOf = (card) => (card.kind === "channel" ? card.title : DIRECT_CHANNEL_SORT_NAME);

function isUnread(card) {
  if (card.kind === "compose") return false;
  const latest = latestMessage(card);
  if (latest === undefined) return false;
  return (slackSeconds(latest.ts) ?? 0) > (memory.opened.get(card.key) ?? 0);
}

function markOpened(card) {
  const seconds = latestSeconds(card);
  if ((memory.opened.get(card.key) ?? -1) >= seconds) return;
  memory.opened.set(card.key, seconds);
  writeOpened();
}

function compareCards(sort, direction) {
  return (left, right) => {
    const a = sort.key(left);
    const b = sort.key(right);
    const order = typeof a === "string" ? a.localeCompare(b) : a - b;
    const directed = direction === "asc" ? order : -order;
    return directed !== 0 ? directed : latestSeconds(right) - latestSeconds(left);
  };
}

const currentFilters = () => ({
  type: ui.type,
  channel: ui.channel,
  person: ui.person,
  priority: ui.priority,
});
const activeQuery = () => ui.query.trim();

function arrangedEntries() {
  const filtered = board.cards.filter((card) => matchesFilters(card, currentFilters()));
  const query = activeQuery();
  if (query === "")
    return filtered
      .sort(compareCards(SORTS[ui.sortBy], ui.sortDir))
      .map((card) => ({ card, matches: [] }));
  return searchCards(filtered, query, plainText);
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function withCurrent(options, current) {
  if (current === ANY || options.some((option) => option.value === current)) return options;
  return [...options, { value: current, label: current }];
}

function channelOptions() {
  const channels = uniqueSorted(
    board.cards.filter((card) => card.kind === "channel").map((card) => card.title),
  );
  const options = [
    { value: ANY, label: "Any channel" },
    { value: DIRECT, label: DIRECT_LABEL },
    ...channels.map((title) => ({ value: title, label: title })),
  ];
  return withCurrent(options, ui.channel);
}

function personOptions() {
  const people = uniqueSorted(
    board.cards.flatMap((card) => card.messages.map((message) => message.authorName)),
  );
  return withCurrent(
    [{ value: ANY, label: "Anyone" }, ...people.map((name) => ({ value: name, label: name }))],
    ui.person,
  );
}

function editsFor(edits, key, proposal) {
  const signature = JSON.stringify(proposal);
  const current = edits.get(key);
  if (current?.signature === signature) return current.texts;
  const texts = new Map();
  edits.set(key, { signature, texts });
  return texts;
}

function editedProposal(edits, key, proposal) {
  const texts = editsFor(edits, key, proposal);
  return {
    ...proposal,
    steps: proposal.steps.map((step, index) =>
      step.type === "slack_reply" ? { ...step, text: texts.get(index) ?? step.text } : step,
    ),
  };
}

function replyPlaceLabel(card, proposal) {
  if (proposal?.replyToTs || card.target.threadTs !== null) return "Reply in the thread";
  if (card.kind === "dm" || card.kind === "group") return "Reply in the DM";
  if (card.kind === "compose") return `Message to ${card.title}`;
  return "Reply in the thread";
}

function readStoredToken() {
  return readStorage("sessionStorage", TOKEN_STORAGE_KEY);
}

function storeToken(token) {
  writeStorage("sessionStorage", TOKEN_STORAGE_KEY, token);
}

function takeFragmentToken() {
  const fragment = new URLSearchParams(location.hash.slice(1));
  if (!fragment.has("token")) return null;
  history.replaceState(null, "", `${location.pathname}${location.search}`);
  const token = fragment.get("token");
  if (token === null || token === "") return null;
  storeToken(token);
  return token;
}

async function api(method, path, body) {
  const headers = { "x-board-token": board.token };
  if (body !== undefined) headers["content-type"] = "application/json";
  let response;
  let text;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    text = await response.text();
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    throw new ApiError(0, UNREACHABLE_MESSAGE);
  }
  if (response.status === 401) {
    signOut();
    throw new ApiError(401, "Open the board with /board in Claude Code");
  }
  const payload = parseJson(text);
  if (!response.ok)
    throw new ApiError(
      response.status,
      typeof payload?.error === "string"
        ? payload.error
        : `The board server answered ${response.status}.`,
    );
  return payload;
}

function parseJson(text) {
  if (text === "") return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return undefined;
  }
}

function readState(payload) {
  if (!isObject(payload) || !Array.isArray(payload.cards) || !isObject(payload.sync))
    throw new ApiError(0, UNREADABLE_MESSAGE);
  const settings = isObject(payload.settings) ? payload.settings : {};
  const notify = isObject(settings.notify) ? settings.notify : {};
  return {
    cards: payload.cards,
    sync: payload.sync,
    news: isObject(payload.news) && Array.isArray(payload.news.items) ? payload.news : null,
    otherMessages:
      isObject(payload.otherMessages) && Array.isArray(payload.otherMessages.channels)
        ? payload.otherMessages
        : NO_OTHER_MESSAGES,
    lookup: isObject(payload.lookup) ? payload.lookup : null,
    polish: settings.polish !== false,
    notify: Object.fromEntries(
      Object.keys(ALL_NOTICES_ON).map((event) => [event, notify[event] !== false]),
    ),
  };
}

function readComposeKey(payload) {
  if (!isObject(payload) || typeof payload.key !== "string")
    throw new ApiError(0, UNREADABLE_MESSAGE);
  return payload.key;
}

function readPeople(payload) {
  if (!isObject(payload) || !Array.isArray(payload.people))
    throw new ApiError(0, UNREADABLE_MESSAGE);
  return payload.people;
}

function reportDefect(error) {
  console.error("slack-board: the page failed", error);
  board.connectionError = `The board page failed (${error instanceof Error ? error.message : String(error)}). Reload the page.`;
  setText(dom.connectionError, board.connectionError);
}

function schedulePoll() {
  clearTimeout(board.pollTimer);
  if (!document.hidden && !board.signedOut)
    board.pollTimer = setTimeout(() => void refreshNow(), POLL_INTERVAL_MS);
}

function refreshNow() {
  clearTimeout(board.pollTimer);
  stateChain = stateChain.then(loadState).catch(reportDefect);
  return stateChain;
}

function statePath() {
  if (!ui.otherOpen || ui.openChannels.size === 0) return "/api/state";
  return `/api/state?channels=${[...ui.openChannels].map(encodeURIComponent).join(",")}`;
}

async function loadState() {
  if (board.signedOut) return;
  try {
    applyState(readState(await api("GET", statePath())));
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    if (error.status === 401) return;
    board.connectionError = error.message;
    renderHeader();
  } finally {
    schedulePoll();
  }
}

function applyState(state) {
  const changes = cardChanges(board.cards, state.cards);
  const notices = board.loaded ? noticesOf(state, changes) : { cards: [], board: [] };
  board.cards = state.cards;
  board.sync = state.sync;
  board.news = state.news;
  board.otherMessages = state.otherMessages;
  forgetClosedChannels();
  board.notify = state.notify;
  board.lookup = state.lookup;
  board.polish = state.polish;
  board.loaded = true;
  board.connectionError = null;
  announce([...announcementsOf(changes), ...notices.board.map(spokenNotice)]);
  notify([...notices.board, ...notices.cards]);
  forgetMissingCards();
  if (ui.openKey !== null && findCard(ui.openKey) === undefined) closeDetail();
  rerunLookupMerge();
  render();
  mention.refresh?.();
  openPendingCard();
}

const ANNOUNCEMENTS = {
  sent: ({ card }) => `Sent: ${card.title}`,
  failed: ({ card, error }) => `Failed: ${card.title}. ${error}`,
  proposal: ({ card }) => `Proposal ready: ${card.title}`,
  answered: ({ card }) => `Claude answered: ${card.title}`,
};

const announcementsOf = (changes) => changes.map((change) => ANNOUNCEMENTS[change.kind](change));

function noticesOf(state, changes) {
  const isAllowed = (notice) => state.notify[notice.event];
  return {
    board: [...newsNotices(board.news, state.news), ...syncNotices(board.sync, state.sync)].filter(
      isAllowed,
    ),
    cards: cardNotices(changes).filter(isAllowed),
  };
}

const spokenNotice = (notice) => `${notice.title}: ${notice.body}`;

const notificationsSupported = () => "Notification" in window;

const isBoardInFront = () => document.visibilityState === "visible" && document.hasFocus();

function notify(notices) {
  const canNotifySystem = notificationsSupported() && Notification.permission === "granted";
  for (const notice of notices) {
    if (isBoardInFront() || !canNotifySystem) showToast(notice);
    else showSystemNotification(notice);
  }
}

function openFromNotice(notice) {
  if (notice.cardKey !== null) openCard(notice.cardKey);
}

function showSystemNotification(notice) {
  try {
    const shown = new Notification(notice.title, { body: notice.body, tag: notice.tag });
    shown.addEventListener("click", () => {
      window.focus();
      shown.close();
      openFromNotice(notice);
    });
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    showToast(notice);
  }
}

function showToast(notice) {
  const toast = el("div", { class: "toast", "data-tag": notice.tag });
  const dismiss = () => toast.remove();
  const content = [
    el("strong", { class: "toast-title", text: notice.title }),
    el("span", { class: "toast-body", text: notice.body }),
  ];
  const main =
    notice.cardKey === null
      ? el("div", { class: "toast-main" }, ...content)
      : el(
          "button",
          {
            type: "button",
            class: "toast-main toast-open",
            onclick: () => {
              dismiss();
              openFromNotice(notice);
            },
          },
          ...content,
        );
  toast.append(
    main,
    el(
      "button",
      {
        type: "button",
        class: "toast-close",
        "aria-label": "Dismiss notification",
        onclick: dismiss,
      },
      icon("close", 14),
    ),
  );
  for (const same of dom.toasts.querySelectorAll(".toast"))
    if (same.dataset.tag === notice.tag) same.remove();
  dom.toasts.append(toast);
  while (dom.toasts.children.length > MAX_TOASTS) dom.toasts.firstElementChild?.remove();
  setTimeout(dismiss, TOAST_MS);
}

function placeToasts() {
  const host = dom.detailDialog.open
    ? dom.detailDialog
    : dom.composeDialog.open
      ? dom.composeDialog
      : dom.app;
  if (dom.toasts.parentElement !== host) host.append(dom.toasts);
}

function renderNotifyButton() {
  dom.notifyButton.hidden = !notificationsSupported();
  if (dom.notifyButton.hidden) return;
  const permission = Notification.permission;
  dom.notifyButton.setAttribute("aria-label", NOTIFY_LABELS[permission]);
  dom.notifyButton.title = NOTIFY_HINTS[permission];
  setDisabled(dom.notifyButton, permission !== "default");
  if (dom.notifyButton.dataset.permission === permission) return;
  dom.notifyButton.dataset.permission = permission;
  dom.notifyButton.replaceChildren(icon(NOTIFY_ICONS[permission], NOTIFY_ICON_PX));
}

async function requestNotifications() {
  await Notification.requestPermission();
  renderNotifyButton();
}

const isPermissionOpen = () => notificationsSupported() && Notification.permission === "default";

async function askForNotificationsOnOpen() {
  if (!isPermissionOpen()) return;
  await requestNotifications();
  if (!isPermissionOpen()) return;
  const askOnFirstUse = () => {
    document.removeEventListener("pointerdown", askOnFirstUse, true);
    document.removeEventListener("keydown", askOnFirstUse, true);
    if (isPermissionOpen()) void requestNotifications().catch(reportDefect);
  };
  document.addEventListener("pointerdown", askOnFirstUse, true);
  document.addEventListener("keydown", askOnFirstUse, true);
}

function forgetMissingCards() {
  const present = new Set(board.cards.map((card) => card.key));
  const cardStores = [
    memory.drafts,
    memory.actionDrafts,
    memory.notes,
    memory.edits,
    memory.actionEdits,
    memory.started,
  ];
  for (const store of cardStores) {
    for (const key of store.keys()) if (!present.has(key)) store.delete(key);
  }
  for (const key of memory.threadDrafts.keys())
    if (!present.has(key.split("\n")[0])) memory.threadDrafts.delete(key);
  const staleOpened = [...memory.opened.keys()].filter((key) => !present.has(key));
  if (staleOpened.length === 0) return;
  for (const key of staleOpened) memory.opened.delete(key);
  writeOpened();
}

function forgetClosedChannels() {
  const present = new Set(board.otherMessages.channels.map((channel) => channel.channelId));
  for (const channelId of ui.openChannels)
    if (!present.has(channelId)) ui.openChannels.delete(channelId);
}

function openPendingCard() {
  const key = ui.pendingOpenKey;
  if (key === null || findCard(key) === undefined) return;
  ui.pendingOpenKey = null;
  openCard(key, "composer");
}

async function runAction(scope, request, { conflictMessage = null, onSuccess = null } = {}) {
  if (requests.inFlight.has(scope)) return { ok: false };
  requests.inFlight.add(scope);
  requests.errors.delete(scope);
  render();
  let result = { ok: false };
  try {
    const payload = await request();
    onSuccess?.(payload);
    result = { ok: true, payload };
  } catch (error) {
    if (!(error instanceof ApiError)) reportDefect(error);
    else if (error.status !== 401) {
      const message =
        error.status === 409 && conflictMessage !== null ? conflictMessage : error.message;
      requests.errors.set(scope, message);
      announce([message]);
    }
  } finally {
    requests.inFlight.delete(scope);
    render();
  }
  if (result.ok) void refreshNow();
  return result;
}

function requestSync() {
  if (requests.inFlight.has("sync")) return;
  void runAction("sync", () => api("POST", "/api/sync"), {
    onSuccess: () => announce(["Sync started"]),
  });
}

function isCardBusy(key) {
  return findCard(key)?.pending != null;
}

function rejectSubmit(scope, message, field) {
  requests.errors.set(scope, message);
  render();
  field?.focus();
}

async function propose(key, text, { scope, control, replyToTs = null }) {
  if (isCardBusy(key)) {
    rejectSubmit(scope, BUSY_MESSAGE, null);
    return false;
  }
  startWork(key, control, "propose", scope);
  const body = replyToTs === null ? { text } : { text, replyToTs };
  const result = await runAction(scope, () => api("POST", `${cardPath(key)}/propose`, body), {
    conflictMessage: BUSY_MESSAGE,
    onSuccess: () => {
      memory.notes.set(key, text);
      announce(["Claude is drafting"]);
    },
  });
  return result.ok;
}

async function sendAsWritten(key, text, { scope, control, replyToTs = null }) {
  if (isCardBusy(key)) {
    rejectSubmit(scope, BUSY_MESSAGE, null);
    return false;
  }
  startWork(key, control, "execute", scope);
  const body = replyToTs === null ? { text } : { text, replyToTs };
  const result = await runAction(scope, () => api("POST", `${cardPath(key)}/send`, body), {
    conflictMessage: BUSY_MESSAGE,
    onSuccess: () => announce(["Sending"]),
  });
  return result.ok;
}

function deliver(key, text, options) {
  return board.polish ? propose(key, text, options) : sendAsWritten(key, text, options);
}

async function submitComposer(key, submit = deliver, control = CONTROLS.draft) {
  const mentions = detail?.composerMentions;
  const text = mentions?.slack().trim() ?? "";
  const scope = scopeOf("propose", key);
  if (text === "") return rejectSubmit(scope, EMPTY_COMPOSER_MESSAGE, mentions);
  if (!(await submit(key, text, { scope, control }))) return;
  memory.drafts.delete(key);
  if (detail?.key === key) detail.composerMentions.set("");
}

function sendReaction(key, reaction) {
  void sendAsWritten(key, reaction, {
    scope: scopeOf("propose", key),
    control: reactionControl(reaction),
  });
}

async function runPrompt(key) {
  const field = detail?.actionField;
  const text = field?.value.trim() ?? "";
  const scope = scopeOf("action", key);
  if (text === "") return rejectSubmit(scope, EMPTY_ACTION_MESSAGE, field);
  if (isCardBusy(key)) return rejectSubmit(scope, BUSY_MESSAGE, null);
  startWork(key, CONTROLS.run, "act", scope);
  const result = await runAction(scope, () => api("POST", `${cardPath(key)}/act`, { text }), {
    conflictMessage: BUSY_MESSAGE,
    onSuccess: () => announce(["Claude is working on your prompt"]),
  });
  if (!result.ok) return;
  memory.actionDrafts.delete(key);
  if (detail?.key === key) detail.actionField.value = "";
}

function requestHistory(key) {
  void runAction(scopeOf("history", key), () => api("POST", `${cardPath(key)}/history`));
}

async function sendThreadReply(key, ts, mentions, submit = deliver, control = CONTROLS.draft) {
  const text = mentions.slack().trim();
  const scope = scopeOf("thread", threadDraftKey(key, ts));
  if (text === "") return rejectSubmit(scope, EMPTY_THREAD_MESSAGE, mentions);
  if (!(await submit(key, text, { scope, control: threadControl(control, ts), replyToTs: ts })))
    return;
  memory.threadDrafts.delete(threadDraftKey(key, ts));
  if (detail?.key !== key || ui.replyToTs !== ts) return;
  ui.replyToTs = null;
  render();
  focusByKey(detail.messageList, `bubble:${ts}`);
}

function approve(key) {
  const card = findCard(key);
  if (card === undefined || card.proposal === null) return;
  const scope = scopeOf("proposal", key);
  if (card.pending !== null) return rejectSubmit(scope, BUSY_MESSAGE, null);
  startWork(key, CONTROLS.approve, "execute", scope);
  const proposal = editedProposal(memory.edits, key, card.proposal);
  void runAction(scope, () => api("POST", `${cardPath(key)}/approve`, { proposal }), {
    conflictMessage: BUSY_MESSAGE,
    onSuccess: () => announce(["Approved. Sending."]),
  });
}

function approveSteps(key) {
  const card = findCard(key);
  const waiting = card?.actionProposal;
  if (waiting === null || waiting === undefined) return;
  const scope = scopeOf("steps", key);
  if (card.pending !== null) return rejectSubmit(scope, BUSY_MESSAGE, null);
  startWork(key, CONTROLS.approveSteps, "execute", scope);
  const proposal = editedProposal(memory.actionEdits, key, waiting.proposal);
  void runAction(
    scope,
    () => api("POST", `${cardPath(key)}/turns/${waiting.turn}/approve`, { proposal }),
    {
      conflictMessage: BUSY_MESSAGE,
      onSuccess: () => announce(["Approved. Sending."]),
    },
  );
}

function discardSteps(key) {
  const card = findCard(key);
  const waiting = card?.actionProposal;
  if (waiting === null || waiting === undefined) return;
  const scope = scopeOf("steps", key);
  if (card.pending !== null) return rejectSubmit(scope, BUSY_MESSAGE, null);
  startWork(key, CONTROLS.discardSteps, null, scope);
  void runAction(scope, () => api("POST", `${cardPath(key)}/turns/${waiting.turn}/discard`), {
    conflictMessage: BUSY_MESSAGE,
    onSuccess: () => {
      memory.actionEdits.delete(key);
      announce(["Steps discarded"]);
    },
  });
}

function discard(key) {
  const card = findCard(key);
  if (card === undefined) return;
  const scope = scopeOf("proposal", key);
  if (card.pending !== null) return rejectSubmit(scope, BUSY_MESSAGE, null);
  startWork(key, CONTROLS.discard, null, scope);
  void runAction(scope, () => api("POST", `${cardPath(key)}/discard`), {
    conflictMessage: BUSY_MESSAGE,
    onSuccess: () => {
      memory.edits.delete(key);
      announce(["Proposal discarded"]);
    },
  });
}

function summarize(ticketKey) {
  void runAction(
    scopeOf("summarize", ticketKey),
    () => api("POST", `/api/tickets/${encodeURIComponent(ticketKey)}/summarize`),
    {
      onSuccess: () => announce([`Claude is reading ${ticketKey}`]),
    },
  );
}

async function ignoreCard(key) {
  const title = findCard(key)?.title ?? "card";
  const result = await runAction(scopeOf("ignore", key), () =>
    api("POST", `${cardPath(key)}/ignore`),
  );
  if (!result.ok) return false;
  board.cards = board.cards.filter((card) => card.key !== key);
  announce([`Ignored ${title}`]);
  if (ui.openKey === key) closeDetail();
  else render();
  return true;
}

async function ignoreFromBoard(key) {
  const keys = [...dom.cardSections.querySelectorAll("[data-card-key]")].map(
    (node) => node.dataset.cardKey,
  );
  const index = keys.indexOf(key);
  const neighbour = keys[index + 1] ?? keys[index - 1];
  if (!(await ignoreCard(key))) return;
  if (neighbour === undefined || !focusByKey(dom.cardSections, scopeOf("card", neighbour)))
    dom.listHeading.focus();
}

function openCard(key, focusTarget = "heading") {
  const card = findCard(key);
  if (card === undefined) return;
  ui.filtersOpen = false;
  ui.openKey = key;
  ui.selectedKey = key;
  ui.actionsOpen = card.actionProposal !== null;
  ui.replyToTs = null;
  detail = buildDetail(card);
  dom.detailDialog.replaceChildren(detail.root);
  if (!dom.detailDialog.open) dom.detailDialog.showModal();
  render();
  if (focusTarget === "composer") detail.composerField.focus();
  else detail.heading.focus();
}

function closeDetail() {
  if (dom.detailDialog.open) dom.detailDialog.close();
  finishDetailClose();
}

function onDetailClosed() {
  if (!dom.detailDialog.open) finishDetailClose();
}

function finishDetailClose() {
  if (detail === null) return;
  const key = ui.openKey;
  ui.openKey = null;
  ui.actionsOpen = false;
  ui.replyToTs = null;
  detail = null;
  dom.detailDialog.replaceChildren();
  render();
  if (key === null || !focusByKey(dom.cardSections, scopeOf("card", key))) dom.listHeading.focus();
}

function toggleActions() {
  ui.actionsOpen = !ui.actionsOpen;
  render();
  if (ui.actionsOpen) detail.actionField.focus();
}

function toggleReply(ts) {
  ui.replyToTs = ui.replyToTs === ts ? null : ts;
  render();
  if (ui.replyToTs === ts) detail.messageRefs.get(ts)?.slot.querySelector("textarea")?.focus();
  else focusByKey(detail.messageList, `bubble:${ts}`);
}

function focusComposer() {
  if (detail === null) return;
  detail.composerField.focus();
  detail.composerField.scrollIntoView({ block: "nearest" });
}

function submitOnModEnter(event) {
  if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) return;
  event.preventDefault();
  event.currentTarget.form?.requestSubmit();
}

function setFilter(name, value) {
  ui[name] = value;
  render();
}

function clearFilters(focusAfter) {
  Object.assign(ui, NO_FILTERS);
  render();
  focusAfter();
}

function focusFirstTypeChip() {
  focusByKey(dom.typeFilters, scopeOf("type", ALL_TYPES));
}

function removeFilter(name) {
  const chips = activeFilters(currentFilters());
  const index = chips.findIndex((chip) => chip.name === name);
  const neighbour = chips[index + 1] ?? chips[index - 1];
  ui[name] = NO_FILTERS[name];
  render();
  if (neighbour === undefined || !focusByKey(dom.activeFilters, scopeOf("chip", neighbour.name)))
    dom.filtersButton.focus();
}

function clearSearchAndFilters() {
  Object.assign(ui, NO_FILTERS);
  setQuery("");
  dom.search.focus();
}

function setQuery(query) {
  ui.query = query;
  if (dom.search.value !== query) dom.search.value = query;
  render();
}

function onSearchKeydown(event) {
  if (event.key !== "Escape" || dom.search.value === "") return;
  event.preventDefault();
  setQuery("");
}

function onShortcutKeydown(event) {
  if (event.key !== SEARCH_SHORTCUT || event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target;
  if (
    isTextField(target) ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
    return;
  if (dom.detailDialog.open || dom.composeDialog.open || dom.app.hidden) return;
  event.preventDefault();
  dom.search.focus();
}

function openFilters() {
  ui.filtersOpen = true;
  render();
  focusFirstTypeChip();
}

function closeFilters({ returnFocus }) {
  if (!ui.filtersOpen) return;
  ui.filtersOpen = false;
  render();
  if (returnFocus) dom.filtersButton.focus();
}

function onFiltersKeydown(event) {
  if (event.key !== "Escape") return;
  event.preventDefault();
  closeFilters({ returnFocus: true });
}

function onOutsidePointer(event) {
  if (
    !ui.filtersOpen ||
    dom.filtersPanel.contains(event.target) ||
    dom.filtersButton.contains(event.target)
  )
    return;
  const focusWasInside = dom.filtersPanel.contains(document.activeElement);
  closeFilters({ returnFocus: false });
  setTimeout(() => {
    const active = document.activeElement;
    if (focusWasInside && (active === document.body || active === null)) dom.filtersButton.focus();
  }, 0);
}

function setGroup(group) {
  ui.group = group;
  writeStorage("localStorage", GROUP_STORAGE_KEY, group);
  render();
}

const collapseKey = (sectionKey) => `${ui.group}:${sectionKey}`;

function toggleSection(sectionKey) {
  const key = collapseKey(sectionKey);
  if (ui.collapsed.has(key)) ui.collapsed.delete(key);
  else ui.collapsed.add(key);
  writeCollapsed();
  render();
}

function toggleOtherMessages() {
  ui.otherOpen = !ui.otherOpen;
  render();
  if (ui.otherOpen && ui.openChannels.size > 0) void refreshNow();
}

function toggleOtherChannel(channelId) {
  if (ui.openChannels.has(channelId)) ui.openChannels.delete(channelId);
  else ui.openChannels.add(channelId);
  render();
  if (ui.openChannels.has(channelId)) void refreshNow();
}

const readMarkOf = (channel) => ({ channelId: channel.channelId, throughTs: channel.latestTs });

function markChannelRead(channel) {
  const leavesSectionEmpty =
    board.otherMessages.channels.length === 1 && !board.otherMessages.isMissing;
  void runAction(
    OTHER_READ,
    () => api("POST", "/api/channel-messages/read", { channels: [readMarkOf(channel)] }),
    {
      onSuccess: () => {
        ui.openChannels.delete(channel.channelId);
        (leavesSectionEmpty ? dom.listHeading : dom.otherToggle).focus();
        announce([`Marked ${channel.label} read`]);
      },
    },
  );
}

function markAllOtherRead() {
  const channels = board.otherMessages.channels.map(readMarkOf);
  void runAction(OTHER_READ, () => api("POST", "/api/channel-messages/read-all", { channels }), {
    onSuccess: () => {
      ui.openChannels.clear();
      dom.listHeading.focus();
      announce(["Marked all other messages read"]);
    },
  });
}

function setSort(sortBy) {
  ui.sortBy = sortBy;
  ui.sortDir = SORTS[sortBy].initial;
  render();
}

function toggleSortDirection() {
  ui.sortDir = ui.sortDir === "asc" ? "desc" : "asc";
  render();
}

function setTheme(theme) {
  ui.theme = theme;
  writeStorage("localStorage", THEME_STORAGE_KEY, theme);
  applyTheme();
}

function applyTheme() {
  const dark = ui.theme === "dark" || (ui.theme === "system" && darkScheme.matches);
  document.documentElement.classList.toggle("sb-dark", dark);
  document.documentElement.classList.toggle("sb-light", !dark);
  for (const button of dom.themeButtons)
    button.setAttribute("aria-pressed", String(button.dataset.themeOption === ui.theme));
}

function setView(view) {
  ui.view = view;
  writeStorage("localStorage", VIEW_STORAGE_KEY, view);
  render();
}

function render() {
  const openCardState = ui.openKey === null ? undefined : findCard(ui.openKey);
  if (openCardState !== undefined) markOpened(openCardState);
  renderHeader();
  renderToolbar();
  renderCards();
  renderOtherMessages();
  renderDetail();
  renderCompose();
  placeToasts();
}

function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  setTimeout(() => {
    renderQueued = false;
    render();
  }, 0);
}

function boardStatusText(nowMs) {
  if (!board.loaded) return "Loading";
  const waiting = `${board.cards.length} waiting`;
  const syncedAt = board.sync.lastSyncAt === null ? null : isoSeconds(board.sync.lastSyncAt);
  return syncedAt === null
    ? `${waiting} · not synced yet`
    : `${waiting} · synced ${relativeLabel(syncedAt, nowMs)}`;
}

function renderHeader() {
  setText(dom.boardStatus, boardStatusText(Date.now()));
  setText(
    dom.syncError,
    board.sync.lastError === null ? "" : `Sync failed: ${board.sync.lastError}`,
  );
  setText(dom.connectionError, board.connectionError ?? "");
  setText(dom.syncButtonError, requests.errors.get("sync") ?? "");
  const isSyncing = requests.inFlight.has("sync") || board.sync.isRunning === true;
  setDisabled(dom.syncButton, isSyncing);
  setBusy(dom.syncButton, isSyncing);
  renderNotifyButton();
}

function syncOptions(select, options, value) {
  syncSection(select, JSON.stringify(options), () =>
    options.map((option) => el("option", { value: option.value, text: option.label })),
  );
  if (select.value !== value) select.value = value;
}

function renderToolbar() {
  for (const button of dom.viewButtons)
    button.setAttribute("aria-pressed", String(button.dataset.viewOption === ui.view));
  const searching = activeQuery() !== "";
  dom.searchClear.hidden = ui.query === "";
  dom.searchHint.hidden = ui.query !== "";
  const chips = activeFilters(currentFilters());
  dom.filtersButton.setAttribute("aria-expanded", String(ui.filtersOpen));
  dom.filtersButton.classList.toggle("has-filters", chips.length > 0);
  dom.filtersCount.hidden = chips.length === 0;
  syncSection(dom.filtersCount, String(chips.length), () => [
    String(chips.length),
    el("span", { class: "sr-only", text: " active" }),
  ]);
  dom.filtersPanel.hidden = !ui.filtersOpen;
  renderFilterPanel();
  renderActiveFilters(chips);
  if (dom.groupSelect.value !== ui.group) dom.groupSelect.value = ui.group;
  dom.sortSelectWrap.hidden = searching;
  dom.bestMatch.hidden = !searching;
  dom.sortDirection.hidden = searching;
  if (dom.sortSelect.value !== ui.sortBy) dom.sortSelect.value = ui.sortBy;
  const directionLabel = SORTS[ui.sortBy].directions[ui.sortDir];
  dom.sortDirection.dataset.direction = ui.sortDir;
  dom.sortDirection.title = directionLabel;
  dom.sortDirection.setAttribute("aria-label", `Sort order: ${directionLabel}. Press to reverse.`);
}

function renderFilterPanel() {
  const chips = TYPE_FILTERS.map((filter) => ({
    ...filter,
    count: board.cards.filter((card) => matchesFilters(card, { ...NO_FILTERS, type: filter.id }))
      .length,
    pressed: ui.type === filter.id,
  }));
  syncSection(dom.typeFilters, JSON.stringify(chips), () => chips.map(typeChip));
  syncOptions(dom.channelSelect, channelOptions(), ui.channel);
  syncOptions(dom.personSelect, personOptions(), ui.person);
  if (dom.prioritySelect.value !== ui.priority) dom.prioritySelect.value = ui.priority;
}

function renderActiveFilters(chips) {
  dom.activeFiltersRow.hidden = chips.length === 0;
  syncSection(dom.activeFilters, JSON.stringify(chips), () =>
    chips.map((chip) =>
      el(
        "li",
        {},
        el(
          "button",
          {
            type: "button",
            class: "sb-chip filter-chip hit44",
            "aria-label": `Remove filter ${chip.label}`,
            "data-focus-key": scopeOf("chip", chip.name),
            onclick: () => removeFilter(chip.name),
          },
          chip.label,
          icon("remove", 10),
        ),
      ),
    ),
  );
}

function typeChip(chip) {
  return el(
    "button",
    {
      type: "button",
      class: "sb-chip type-chip hit44",
      "aria-pressed": String(chip.pressed),
      "data-focus-key": scopeOf("type", chip.id),
      onclick: () => setFilter("type", chip.id),
    },
    `${chip.label} `,
    el("span", { class: "type-chip-count", text: String(chip.count) }),
  );
}

function cardModel(card, matches, query) {
  const latest = latestMessage(card);
  const excerpt =
    latest === undefined
      ? "Write your message, approve it, and it goes out."
      : plainText(latest.text);
  const searching = query !== "";
  return {
    key: card.key,
    title: card.title,
    titleParts: highlightParts(card.title, searching ? titleRanges(matches) : []),
    excerptParts: highlightParts(
      excerpt,
      searching ? excerptRanges(card, matches, query, plainText) : [],
    ),
    avatarName: avatarName(card),
    place: placeOf(card),
    status: statusOf(card),
    priority: card.priority,
    priorityReason: card.priorityReason,
    tickets: card.tickets.map((ticket) => ticket.key),
    count: card.messages.length,
    seconds: latestSeconds(card),
  };
}

function renderCards() {
  const entries = arrangedEntries();
  const query = activeQuery();
  const matchesByKey = new Map(entries.map((entry) => [entry.card.key, entry.matches]));
  const sections = groupCards(
    entries.map((entry) => entry.card),
    ui.group,
  );
  setText(dom.visibleCount, board.loaded ? String(entries.length) : "");
  setText(
    dom.listStatus,
    !board.loaded
      ? "Loading cards…"
      : board.cards.length === 0
        ? "Nothing is waiting for you."
        : "",
  );
  dom.emptyState.hidden = !board.loaded || board.cards.length === 0 || entries.length > 0;
  const stagger = { created: 0 };
  const usedCards = new Set();
  const usedSections = new Set();
  const roots = sections.map((section) => {
    const node = sectionNode(section);
    usedSections.add(node.id);
    const collapsed = ui.group !== NO_GROUP && ui.collapsed.has(collapseKey(section.key));
    updateSectionHeader(node, section, collapsed);
    node.list.className = `cards cards--${ui.view}`;
    node.list.hidden = collapsed;
    const visibleInSection = collapsed ? [] : section.cards;
    for (const card of visibleInSection) usedCards.add(card.key);
    placeChildren(
      node.list,
      visibleInSection.map((card) => cardItem(card, matchesByKey.get(card.key), query, stagger)),
    );
    return node.root;
  });
  for (const key of cardNodes.keys()) if (!usedCards.has(key)) cardNodes.delete(key);
  for (const key of sectionNodes.keys()) if (!usedSections.has(key)) sectionNodes.delete(key);
  placeChildren(dom.cardSections, roots);
}

function sectionNode(section) {
  const id = collapseKey(section.key);
  const existing = sectionNodes.get(id);
  if (existing !== undefined) return existing;
  sectionCounter += 1;
  const listId = `section-list-${sectionCounter}`;
  const list = el("ul", { id: listId, class: "cards" });
  if (ui.group === NO_GROUP) {
    const plain = {
      id,
      root: el("div", { class: "board-section" }, list),
      list,
      toggle: null,
      count: null,
    };
    sectionNodes.set(id, plain);
    return plain;
  }
  const count = el("span", { class: "section-count" });
  const toggle = el(
    "button",
    {
      type: "button",
      class: "section-toggle",
      "aria-expanded": "true",
      "aria-controls": listId,
      "data-focus-key": scopeOf("section", id),
      onclick: () => toggleSection(section.key),
    },
    icon("chevron"),
    el("span", { class: `section-dot section-dot--${section.tone}`, "aria-hidden": "true" }),
    el("span", { class: "section-label", text: section.label }),
    count,
  );
  const node = {
    id,
    root: el(
      "section",
      { class: "board-section", "aria-label": section.label },
      el("h3", { class: "section-heading" }, toggle),
      list,
    ),
    list,
    toggle,
    count,
  };
  sectionNodes.set(id, node);
  return node;
}

function updateSectionHeader(node, section, collapsed) {
  if (node.toggle === null) return;
  node.toggle.setAttribute("aria-expanded", String(!collapsed));
  setText(node.count, String(section.cards.length));
}

function renderOtherMessages() {
  const other = board.otherMessages;
  dom.otherMessages.hidden = !board.loaded || (other.total === 0 && !other.isMissing);
  dom.otherToggle.setAttribute("aria-expanded", String(ui.otherOpen));
  setText(dom.otherCount, String(other.total));
  dom.otherMissing.hidden = !other.isMissing;
  const isMarking = requests.inFlight.has(OTHER_READ);
  setDisabled(dom.otherReadAll, isMarking);
  setBusy(dom.otherReadAll, isMarking);
  setText(dom.otherError, requests.errors.get(OTHER_READ) ?? "");
  dom.otherChannels.hidden = !ui.otherOpen;
  if (!ui.otherOpen) return;
  const channels = other.channels.map((channel) => ({
    ...channel,
    isOpen: ui.openChannels.has(channel.channelId),
    isMarking,
  }));
  syncSection(dom.otherChannels, JSON.stringify(channels), () => channels.map(otherChannelItem));
}

function otherChannelItem(channel) {
  const listId = `other-channel-${channel.channelId}`;
  const messages =
    channel.messages === null
      ? [el("li", { class: "hint", text: OTHER_LOADING_MESSAGE })]
      : channel.messages.map(otherMessageItem);
  return el(
    "li",
    { class: "other-channel" },
    el(
      "div",
      { class: "other-channel-head" },
      el(
        "button",
        {
          type: "button",
          class: "other-channel-toggle",
          "aria-expanded": String(channel.isOpen),
          "aria-controls": listId,
          "data-focus-key": scopeOf("other-channel", channel.channelId),
          onclick: () => toggleOtherChannel(channel.channelId),
        },
        icon("chevron"),
        el("span", { class: "other-channel-name", text: channel.label }),
        el("span", { class: "section-count", text: String(channel.count) }),
        el("span", { class: "sr-only", text: channel.count === 1 ? " message" : " messages" }),
        timeNode(slackSeconds(channel.latestTs), "other-channel-time"),
      ),
      el(
        "button",
        {
          type: "button",
          class: "button-link button-link--small",
          "aria-label": `Mark ${channel.label} read`,
          "aria-disabled": String(channel.isMarking),
          "aria-busy": String(channel.isMarking),
          "data-focus-key": scopeOf(OTHER_READ, channel.channelId),
          onclick: () => markChannelRead(channel),
        },
        "Mark read",
      ),
    ),
    el("ul", { id: listId, class: "other-list", hidden: !channel.isOpen }, ...messages),
  );
}

function otherMessageItem(message) {
  const href = safeHref(message.permalink);
  return el(
    "li",
    { class: "other-message" },
    avatar(message.authorName, "avatar--36"),
    el(
      "div",
      { class: "other-message-body" },
      el(
        "p",
        { class: "other-message-meta" },
        el("span", { class: "bubble-author", text: message.authorName }),
        timeNode(slackSeconds(message.ts), "bubble-time"),
        href === null ? null : externalLink(href, "Open in Slack", "other-message-link"),
      ),
      message.text === ""
        ? el("p", { class: "hint", text: OTHER_NO_TEXT_MESSAGE })
        : el(
            "p",
            { class: "bubble-text" },
            ...messageSegments(message.text, null).map(segmentNode),
          ),
    ),
  );
}

function cardItem(card, matches, query, stagger) {
  const model = cardModel(card, matches, query);
  const signature = JSON.stringify([ui.view, model]);
  let entry = cardNodes.get(card.key);
  if (entry === undefined || entry.signature !== signature) {
    const delayMs = Math.min(stagger.created, CARD_STAGGER_LIMIT) * CARD_STAGGER_MS;
    stagger.created += 1;
    entry = { signature, ...buildCard(model, delayMs, entry === undefined) };
    cardNodes.set(card.key, entry);
  }
  applyCardFlags(entry, card);
  return entry.item;
}

function placeChildren(container, items) {
  const current = [...container.children];
  if (current.length === items.length && current.every((node, index) => node === items[index]))
    return;
  const active = document.activeElement;
  const focusKey =
    active instanceof HTMLElement && container.contains(active)
      ? active.dataset.focusKey
      : undefined;
  container.replaceChildren(...items);
  if (focusKey !== undefined && document.activeElement !== active) focusByKey(container, focusKey);
}

function applyCardFlags(entry, card) {
  const current = card.key === ui.selectedKey;
  if (current) entry.button.setAttribute("aria-current", "true");
  else entry.button.removeAttribute("aria-current");
  entry.shell.classList.toggle("is-current", current);
  const unread = isUnread(card);
  entry.dot.hidden = !unread;
  entry.unreadLabel.hidden = !unread;
  const ignoreScope = scopeOf("ignore", card.key);
  setDisabled(entry.ignoreButton, requests.inFlight.has(ignoreScope));
  setBusy(entry.ignoreButton, requests.inFlight.has(ignoreScope));
  setText(entry.ignoreError, requests.errors.get(ignoreScope) ?? "");
}

function highlightedNodes(parts) {
  return parts.map((part) =>
    part.match ? el("mark", { class: "hl", text: part.text }) : document.createTextNode(part.text),
  );
}

function buildCard(model, delayMs, animate) {
  const tiles = ui.view === "tiles";
  const dot = el("span", { class: "sb-dot unread-dot", "aria-hidden": "true" });
  const unreadLabel = el("span", { class: "sr-only", text: "Unread, " });
  const titleRow = el(
    "span",
    { class: "card-title-row" },
    dot,
    unreadLabel,
    el("span", { class: "card-title" }, ...highlightedNodes(model.titleParts)),
  );
  const button = el(
    "button",
    {
      type: "button",
      class: `card ${tiles ? "card--tile" : "card--row"}`,
      "aria-haspopup": "dialog",
      "data-focus-key": scopeOf("card", model.key),
      onclick: () => openCard(model.key),
    },
    ...(tiles ? tileContent(model, titleRow) : rowContent(model, titleRow)),
  );
  const ignoreButton = el(
    "button",
    {
      type: "button",
      class: "sb-ignore card-ignore",
      "aria-label": `Ignore ${model.title}`,
      title: "Ignore",
      "data-focus-key": scopeOf("ignore", model.key),
      onclick: (event) => !isDisabled(event.currentTarget) && void ignoreFromBoard(model.key),
    },
    icon("close"),
  );
  const ignoreError = errorLine("card-error");
  const shell = el(
    "article",
    {
      class: `sb-card card-shell ${tiles ? "card-shell--tile" : "card-shell--row"}${animate ? "" : " is-settled"}`,
      "data-card-key": model.key,
      onanimationend: (event) => {
        if (event.target === event.currentTarget) event.currentTarget.classList.add("is-settled");
      },
    },
    button,
    ignoreButton,
    ignoreError,
  );
  shell.style.animationDelay = `${delayMs}ms`;
  return { item: el("li", {}, shell), shell, button, ignoreButton, ignoreError, dot, unreadLabel };
}

function statusPill(status) {
  return el("span", { class: `pill pill--${status}`, text: STATUSES[status].label });
}

function tileContent(model, titleRow) {
  return [
    el(
      "span",
      { class: "card-head" },
      avatar(model.avatarName, "avatar--44"),
      el(
        "span",
        { class: "card-id" },
        titleRow,
        el("span", { class: "card-place" }, `${model.place} · `, timeNode(model.seconds, "")),
      ),
    ),
    el("span", { class: "card-excerpt" }, ...highlightedNodes(model.excerptParts)),
    el(
      "span",
      { class: "card-foot" },
      priorityBadge(model.priority, model.priorityReason),
      statusPill(model.status),
      ...model.tickets.map((key) => el("span", { class: "key-chip", text: key })),
      model.count > 1 ? el("span", { class: "card-count", text: `${model.count} messages` }) : null,
    ),
  ];
}

function rowContent(model, titleRow) {
  const [firstTicket, ...otherTickets] = model.tickets;
  return [
    avatar(model.avatarName, "avatar--40 avatar--ring"),
    el(
      "span",
      { class: "card-id" },
      titleRow,
      el("span", { class: "card-place", text: model.place }),
    ),
    el("span", { class: "card-excerpt" }, ...highlightedNodes(model.excerptParts)),
    el(
      "span",
      { class: "card-foot" },
      firstTicket === undefined ? null : el("span", { class: "key-chip", text: firstTicket }),
      otherTickets.length === 0
        ? null
        : el("span", { class: "key-chip", text: `+${otherTickets.length}` }),
      priorityBadge(model.priority, model.priorityReason),
      statusPill(model.status),
    ),
    timeNode(model.seconds, "card-time"),
  ];
}

function buildDetail(card) {
  const key = card.key;
  const refs = { key, messageRefs: new Map() };
  refs.avatarSlot = el("span", { class: "detail-avatar" });
  refs.heading = el("h2", { id: "detail-heading", class: "detail-title", tabindex: "-1" });
  refs.place = el("p", { class: "detail-place" });
  refs.priority = el("p", { class: "detail-priority" });
  refs.slackLink = el(
    "a",
    { class: "slack-link", target: "_blank", rel: "noreferrer noopener" },
    "Open in Slack",
    el("span", { class: "sr-only", text: NEW_TAB_HINT }),
    icon("external", 14),
  );
  refs.ignoreButton = el(
    "button",
    {
      type: "button",
      class: "button button-quiet",
      onclick: (event) => !isDisabled(event.currentTarget) && void ignoreCard(key),
    },
    "Ignore",
  );
  refs.ignoreError = errorLine("detail-error");
  const head = el(
    "div",
    { class: "detail-head" },
    refs.avatarSlot,
    el("div", { class: "detail-id" }, refs.heading, refs.place, refs.priority),
    refs.slackLink,
    refs.ignoreButton,
    el(
      "button",
      { type: "button", class: "icon-button", "aria-label": "Close", onclick: closeDetail },
      icon("close"),
    ),
    refs.ignoreError,
  );
  refs.actions = buildActions(key, refs);
  refs.conversation = buildConversation(refs);
  refs.tickets = el("div", { class: "tickets" });
  refs.bannerText = el("span", { class: "banner-text" });
  refs.banner = el(
    "div",
    { class: "banner", role: "alert", hidden: true },
    icon("alert", 18),
    refs.bannerText,
    el("button", { type: "button", class: "banner-button", onclick: focusComposer }, "Try again"),
  );
  refs.working = el("div", { class: "working", role: "status", hidden: true });
  refs.proposal = el("section", {
    class: "proposal sb-section",
    "aria-labelledby": "proposal-heading",
    hidden: true,
  });
  const composer = buildComposer(key, refs);
  refs.root = el(
    "section",
    { class: "sb-dialog detail" },
    el("span", { class: "sheet-handle", "aria-hidden": "true" }),
    head,
    refs.actions,
    refs.conversation,
    refs.tickets,
    refs.banner,
    refs.working,
    refs.proposal,
    composer,
  );
  return refs;
}

function buildActions(key, refs) {
  refs.actionCount = el("span", { class: "count-badge" });
  refs.actionsToggle = el(
    "button",
    {
      type: "button",
      class: "actions-toggle",
      "aria-expanded": "false",
      "aria-controls": "actions-body",
      onclick: toggleActions,
    },
    el("span", { class: "actions-chevron" }, icon("chevron", 14)),
    icon("bolt", 14),
    "Actions",
    refs.actionCount,
  );
  refs.actionTurns = el("ol", {
    class: "action-turns",
    "aria-label": "Prompts and answers",
    tabindex: "0",
  });
  refs.actionWorking = el("p", { class: "action-working", role: "status", hidden: true });
  refs.actionIntro = el("p", { class: "action-intro", text: ACTIONS_INTRO });
  refs.actionField = el("textarea", {
    id: "action-note",
    class: "textarea",
    rows: "2",
    placeholder: "What should Claude do?",
    onkeydown: submitOnModEnter,
  });
  refs.actionField.value = memory.actionDrafts.get(key) ?? "";
  refs.actionField.addEventListener("input", () =>
    memory.actionDrafts.set(key, refs.actionField.value),
  );
  refs.actionSubmit = el(
    "button",
    { type: "submit", class: "sb-btn button button-strong" },
    icon("bolt", 14),
    "Run",
  );
  refs.actionError = errorLine();
  refs.actionsBody = el(
    "div",
    { id: "actions-body", class: "actions-body sb-section", hidden: true },
    refs.actionTurns,
    refs.actionWorking,
    refs.actionIntro,
    el(
      "form",
      {
        class: "action-form",
        onsubmit: (event) => {
          event.preventDefault();
          if (!isDisabled(refs.actionSubmit)) void runPrompt(key);
        },
      },
      el("label", { for: "action-note", class: "field-label", text: "Prompt" }),
      refs.actionField,
      el(
        "div",
        { class: "button-row button-row--end" },
        el("span", { class: "draft-shortcut", text: "Ctrl+Enter" }),
        refs.actionSubmit,
      ),
      refs.actionError,
    ),
  );
  return el(
    "section",
    { class: "actions", "aria-labelledby": "actions-heading" },
    el(
      "div",
      { class: "section-head" },
      el("h3", { id: "actions-heading", class: "section-title" }, refs.actionsToggle),
      el("span", { class: "section-rule", "aria-hidden": "true" }),
      el("span", { class: "section-hint", text: "Prompts for Claude about this conversation" }),
    ),
    refs.actionsBody,
  );
}

function buildConversation(refs) {
  refs.messageCount = el("span", { class: "count-badge" });
  refs.messageList = el("ol", { class: "messages", "aria-label": "Messages" });
  refs.historyNote = el("p", { class: "hint history-note" });
  return el(
    "section",
    { class: "conversation", "aria-labelledby": "conversation-heading" },
    el(
      "div",
      { class: "section-head" },
      el("h3", { id: "conversation-heading", class: "section-title", text: "Conversation" }),
      refs.messageCount,
      el("span", { class: "section-rule", "aria-hidden": "true" }),
      el("span", {
        class: "section-hint",
        text: "The whole thread from Slack. Click a message to reply in its thread",
      }),
    ),
    refs.messageList,
    refs.historyNote,
  );
}

function buildComposer(key, refs) {
  refs.composerField = el("textarea", {
    id: "composer-note",
    class: "textarea textarea--soft",
    rows: "3",
    placeholder: board.polish
      ? "Write in any language, broken is fine. Claude rewrites it in your voice."
      : "Your reply, sent exactly as you write it. An emoji code like :+1: becomes a reaction.",
    "aria-describedby": "composer-status",
    onkeydown: submitOnModEnter,
  });
  refs.composerMentions = mentionsFor(
    refs.composerField,
    key,
    memory.drafts.get(key) ?? "",
    (slack) => memory.drafts.set(key, slack),
  );
  refs.reactionButtons = QUICK_REACTIONS.map((reaction) =>
    el(
      "button",
      {
        type: "button",
        class: "sb-chip reaction hit44",
        "aria-label": `React with ${reaction} now`,
        onclick: (event) => !isDisabled(event.currentTarget) && sendReaction(key, reaction),
      },
      reaction,
    ),
  );
  refs.sendWrittenButton = board.polish
    ? el(
        "button",
        {
          type: "button",
          class: "sb-chip button button-outline",
          onclick: (event) =>
            !isDisabled(event.currentTarget) &&
            void submitComposer(key, sendAsWritten, CONTROLS.send),
        },
        icon("send", 14),
        "Send as written",
      )
    : null;
  refs.draftButton = el(
    "button",
    { type: "submit", class: "button button-strong" },
    board.polish ? "Draft" : "Send",
    el("span", { class: "draft-shortcut", text: "Ctrl+Enter" }),
  );
  refs.composerStatus = el("p", { id: "composer-status", class: "hint" });
  refs.composerError = errorLine();
  return el(
    "form",
    {
      class: "composer",
      onsubmit: (event) => {
        event.preventDefault();
        if (!isDisabled(refs.draftButton)) void submitComposer(key);
      },
    },
    el("label", {
      for: "composer-note",
      class: "field-label",
      text: board.polish ? "Reply, emoji or instruction" : "Reply or emoji code",
    }),
    refs.composerMentions.node,
    el(
      "div",
      { class: "button-row" },
      el("span", { class: "hint", text: "React now" }),
      ...refs.reactionButtons,
    ),
    el("div", { class: "button-row button-row--end" }, refs.sendWrittenButton, refs.draftButton),
    refs.composerStatus,
    refs.composerError,
  );
}

function renderDetail() {
  if (detail === null) return;
  const card = findCard(detail.key);
  if (card === undefined) return;
  updateDetailHead(detail, card);
  updateActions(detail, card);
  updateConversation(detail, card);
  updateTickets(detail, card);
  updateCardState(detail, card);
  updateProposal(detail, card);
  updateComposer(detail, card);
}

function updateDetailHead(refs, card) {
  const name = avatarName(card);
  syncSection(refs.avatarSlot, name, () => [avatar(name, "avatar--52")]);
  setText(refs.heading, card.title);
  const seconds = latestSeconds(card);
  syncSection(refs.place, JSON.stringify([placeOf(card), seconds]), () => [
    `${placeOf(card)} · `,
    timeNode(seconds, ""),
  ]);
  refs.priority.hidden = PRIORITIES[card.priority] === undefined;
  syncSection(refs.priority, JSON.stringify([card.priority, card.priorityReason]), () =>
    [
      priorityBadge(card.priority, card.priorityReason),
      card.priorityReason === null
        ? null
        : el("span", { class: "detail-priority-reason", text: card.priorityReason }),
    ].filter((node) => node !== null),
  );
  const permalink = safeHref(latestMessage(card)?.permalink);
  refs.slackLink.hidden = permalink === null;
  if (permalink !== null && refs.slackLink.getAttribute("href") !== permalink)
    refs.slackLink.setAttribute("href", permalink);
  const ignoreScope = scopeOf("ignore", card.key);
  setDisabled(refs.ignoreButton, requests.inFlight.has(ignoreScope));
  setBusy(refs.ignoreButton, requests.inFlight.has(ignoreScope));
  setText(refs.ignoreError, requests.errors.get(ignoreScope) ?? "");
}

function scrollToEnd(list) {
  list.scrollTop = list.scrollHeight;
}

function actionWork(card) {
  if (card.pending?.kind === "act")
    return { title: "Claude is working.", text: " The answer shows up here." };
  if (card.actionProposal?.isRunning === true) return RUNNING_STEPS_WORK;
  return null;
}

function updateActions(refs, card) {
  const turnsAtEnd = isScrolledToEnd(refs.actionTurns);
  refs.actionsToggle.setAttribute("aria-expanded", String(ui.actionsOpen));
  refs.actionsBody.hidden = !ui.actionsOpen;
  setText(refs.actionCount, String(card.actions.length));
  const work = actionWork(card);
  refs.actionWorking.hidden = work === null;
  syncSection(refs.actionWorking, JSON.stringify(work), () => workNodes(work));
  refs.actionIntro.hidden = card.actions.length > 0;
  refs.actionTurns.hidden = card.actions.length === 0;
  const ticketKeys = boardTicketKeys();
  const waiting = card.actionProposal;
  syncSection(
    refs.actionTurns,
    JSON.stringify([
      card.actions,
      waiting?.turn,
      waiting?.proposal,
      waiting?.approveCloses,
      replyPlaceLabel(card, waiting?.proposal),
      ticketKeys,
    ]),
    () => turnNodes(card, ticketKeys, refs),
  );
  if (turnsAtEnd) scrollToEnd(refs.actionTurns);
  const scope = scopeOf("action", card.key);
  setDisabled(refs.actionSubmit, card.pending !== null || requests.inFlight.has(scope));
  setBusy(refs.actionSubmit, spinningControlOf(card) === CONTROLS.run);
  setText(refs.actionError, requests.errors.get(scope) ?? "");
  updateApprovalControls(refs.stepsControls, card, scopeOf("steps", card.key), {
    approve: CONTROLS.approveSteps,
    discard: CONTROLS.discardSteps,
  });
}

function stepsNode(card, refs) {
  const waiting = card.actionProposal;
  const parts = approvalParts(waiting.proposal, waiting.approveCloses, {
    cardKey: card.key,
    texts: editsFor(memory.actionEdits, card.key, waiting.proposal),
    replyLabel: replyPlaceLabel(card, waiting.proposal),
    idPrefix: "actions",
    onApprove: () => approveSteps(card.key),
    onDiscard: () => discardSteps(card.key),
  });
  refs.stepsControls = parts.controls;
  return el(
    "div",
    { class: "turn-proposal", role: "group", "aria-labelledby": "turn-proposal-label" },
    el(
      "div",
      {},
      el("p", {
        id: "turn-proposal-label",
        class: "turn-proposal-label",
        text: "Steps to approve",
      }),
      el("p", { class: "proposal-summary", text: waiting.proposal.summary }),
    ),
    parts.steps,
    el("div", { class: "turn-proposal-actions" }, ...parts.buttons, parts.hint),
    parts.error,
  );
}

function turnNodes(card, ticketKeys, refs) {
  const pattern = ticketPattern(ticketKeys);
  const stepsTurn = card.actionProposal?.turn ?? null;
  refs.stepsControls = null;
  return card.actions.map((turn, index) => {
    const text = el(
      "p",
      { class: "turn-text" },
      ...messageSegments(turn.text, pattern).map(segmentNode),
    );
    const at = timeNode(isoSeconds(turn.at), "");
    if (turn.author === "me")
      return el(
        "li",
        { class: "sb-msg turn turn--mine" },
        el("div", { class: "turn-bubble" }, text, el("p", { class: "turn-meta" }, "You · ", at)),
      );
    return el(
      "li",
      { class: `sb-msg turn${turn.isFailed ? " turn--failed" : ""}` },
      el("span", { class: "turn-mark", "aria-hidden": "true" }, icon("spark", 14)),
      el(
        "div",
        { class: "turn-bubble" },
        text,
        turn.tools.length === 0
          ? null
          : el("p", { class: "turn-tools", text: `Looked at ${turn.tools.join(", ")}` }),
        index === stepsTurn ? stepsNode(card, refs) : null,
        el("p", { class: "turn-meta" }, turn.isFailed ? "Failed · " : "Claude · ", at),
      ),
    );
  });
}

function updateConversation(refs, card) {
  refs.conversation.hidden = card.kind === "compose";
  if (card.kind === "compose") return;
  const messagesAtEnd = isScrolledToEnd(refs.messageList);
  const latestTs = latestMessage(card)?.ts ?? null;
  if (latestTs !== refs.historyTs) {
    refs.historyTs = latestTs;
    requestHistory(card.key);
  }
  setText(refs.messageCount, String(card.conversation.length));
  const ticketKeys = boardTicketKeys();
  syncSection(refs.messageList, JSON.stringify([card.conversation, ticketKeys]), () =>
    messageNodes(card, ticketKeys, refs),
  );
  const historyError = card.historyError ?? requests.errors.get(scopeOf("history", card.key));
  setText(
    refs.historyNote,
    historyError === undefined ? "" : `${HISTORY_ERROR_PREFIX}${historyError}`,
  );
  updateThreadReplies(refs, card);
  if (messagesAtEnd) scrollToEnd(refs.messageList);
}

const newMessagesDivider = () =>
  el("li", { class: "new-divider" }, el("span", { text: "New since your last reply" }));

function messageNodes(card, ticketKeys, refs) {
  const pattern = ticketPattern(ticketKeys);
  const messages = card.conversation;
  const lastIndex = messages.length - 1;
  refs.messageRefs = new Map();
  return messages.flatMap((message, index) => {
    const authorOf = (candidate) => candidate.authorId ?? candidate.authorName;
    const startsGroup =
      index === 0 || message.startsNew || authorOf(messages[index - 1]) !== authorOf(message);
    const isWaiting = index === lastIndex && !message.isMine;
    const author = message.isMine ? "You" : message.authorName;
    const textId = `message-text-${index}`;
    const replyButton = el(
      "button",
      {
        type: "button",
        class: "bubble-hit",
        "aria-expanded": "false",
        "aria-describedby": textId,
        "data-focus-key": `bubble:${message.ts}`,
        onclick: () => toggleReply(message.ts),
      },
      el("span", { class: "sr-only", text: "Reply in a thread to " }),
      el("span", { class: "bubble-author", text: author }),
      timeNode(slackSeconds(message.ts), "bubble-time"),
    );
    const slot = el("div", { class: "thread-slot" });
    refs.messageRefs.set(message.ts, { button: replyButton, slot, message, form: null });
    const bubbleClass = message.isMine ? " bubble--mine" : isWaiting ? " bubble--latest" : "";
    const item = el(
      "li",
      {
        class: `sb-msg message${startsGroup ? " message--group-start" : ""}${message.isMine ? " message--mine" : ""}`,
      },
      message.isMine
        ? null
        : startsGroup
          ? avatar(message.authorName, "avatar--36")
          : el("span", { class: "avatar-spacer", "aria-hidden": "true" }),
      el(
        "div",
        { class: "message-body" },
        el(
          "div",
          { class: `sb-bubble bubble${bubbleClass}` },
          el(
            "p",
            { id: textId, class: "bubble-text" },
            ...messageSegments(message.text, pattern).map(segmentNode),
          ),
          replyButton,
        ),
        slot,
        isWaiting
          ? el(
              "span",
              { class: "waiting" },
              el("span", { class: "sb-dot waiting-dot", "aria-hidden": "true" }),
              "Waiting for your reply",
            )
          : null,
      ),
    );
    item.style.animationDelay = `${MESSAGE_STAGGER_BASE_MS + index * MESSAGE_STAGGER_MS}ms`;
    return message.startsNew ? [newMessagesDivider(), item] : [item];
  });
}

function updateThreadReplies(refs, card) {
  for (const [ts, entry] of refs.messageRefs) {
    const open = ui.replyToTs === ts;
    entry.button.setAttribute("aria-expanded", String(open));
    if (!open) {
      if (entry.form !== null) entry.slot.replaceChildren();
      entry.form = null;
      continue;
    }
    if (entry.form === null) {
      entry.form = threadReplyForm(card.key, entry.message);
      entry.slot.replaceChildren(entry.form.node);
    }
    const scope = scopeOf("thread", threadDraftKey(card.key, ts));
    const busy = card.pending !== null || requests.inFlight.has(scope);
    setDisabled(entry.form.submit, busy);
    if (entry.form.sendWritten !== null) setDisabled(entry.form.sendWritten, busy);
    spinOnly(
      new Map([
        [threadControl(CONTROLS.draft, ts), entry.form.submit],
        [threadControl(CONTROLS.send, ts), entry.form.sendWritten ?? entry.form.submit],
      ]),
      spinningControlOf(card),
    );
    setText(entry.form.error, requests.errors.get(scope) ?? "");
  }
}

function threadReplyForm(cardKey, message) {
  const draftKey = threadDraftKey(cardKey, message.ts);
  const fieldId = `thread-reply-${message.ts.replace(/\W/g, "-")}`;
  const field = el("textarea", {
    id: fieldId,
    class: "textarea textarea--small",
    rows: "2",
    placeholder: board.polish
      ? "Any language, broken is fine. Claude drafts it in your voice and you approve it."
      : "Your thread reply, sent exactly as you write it.",
    onkeydown: submitOnModEnter,
  });
  const mentions = mentionsFor(field, cardKey, memory.threadDrafts.get(draftKey) ?? "", (slack) =>
    memory.threadDrafts.set(draftKey, slack),
  );
  const submit = el(
    "button",
    { type: "submit", class: "sb-btn button button-strong button-small" },
    board.polish ? "Draft thread reply" : "Send thread reply",
  );
  const sendWritten = board.polish
    ? el(
        "button",
        {
          type: "button",
          class: "sb-chip button button-outline button-small",
          onclick: (event) =>
            !isDisabled(event.currentTarget) &&
            void sendThreadReply(cardKey, message.ts, mentions, sendAsWritten, CONTROLS.send),
        },
        "Send as written",
      )
    : null;
  const error = errorLine();
  const node = el(
    "form",
    {
      class: "thread-reply sb-section",
      onsubmit: (event) => {
        event.preventDefault();
        if (!isDisabled(submit)) void sendThreadReply(cardKey, message.ts, mentions);
      },
    },
    el("label", {
      for: fieldId,
      class: "thread-reply-label",
      text: message.isMine
        ? "Reply in the thread of your message"
        : `Reply to ${message.authorName} in a thread`,
    }),
    mentions.node,
    el(
      "div",
      { class: "button-row" },
      submit,
      sendWritten,
      el(
        "button",
        {
          type: "button",
          class: "button button-quiet button-small",
          onclick: () => toggleReply(message.ts),
        },
        "Cancel",
      ),
    ),
    error,
  );
  return { node, submit, sendWritten, error };
}

function updateTickets(refs, card) {
  const views = card.tickets.map((ticket) => {
    const scope = scopeOf("summarize", ticket.key);
    return {
      ticket,
      busy: requests.inFlight.has(scope),
      error: requests.errors.get(scope) ?? null,
    };
  });
  syncSection(refs.tickets, JSON.stringify(views), () => views.map(ticketNode));
}

function ticketNode({ ticket, busy, error }) {
  const keyChip = el("span", { class: "key-chip key-chip--strong", text: ticket.key });
  const section = el("section", {
    class: "ticket",
    "aria-label": `Ticket ${ticket.key}`,
    "aria-busy": ticket.status === "loading" ? "true" : null,
  });
  if (ticket.status === "loading") {
    section.append(
      el(
        "div",
        { class: "ticket-head" },
        keyChip,
        el("span", { class: "skeleton", "aria-hidden": "true" }),
        el("span", { class: "sr-only", text: `Loading ${ticket.key}` }),
      ),
    );
    return section;
  }
  if (ticket.status !== "ready" || ticket.details === null) {
    section.append(
      el(
        "div",
        { class: "ticket-head" },
        keyChip,
        el("p", {
          class: "field-error",
          text: ticket.error ?? `${ticket.key} could not be loaded.`,
        }),
      ),
    );
    return section;
  }
  section.append(...readyTicketNodes(ticket, keyChip), summaryNode(ticket, busy));
  if (error !== null) section.append(errorLine("", error));
  return section;
}

function readyTicketNodes(ticket, keyChip) {
  const { details } = ticket;
  const href = safeHref(details.url);
  const title =
    href === null
      ? el("strong", { class: "ticket-title", text: details.title })
      : el("strong", { class: "ticket-title" }, externalLink(href, details.title));
  const updated = details.updated === null ? null : isoSeconds(details.updated);
  return [
    el(
      "div",
      { class: "ticket-head" },
      keyChip,
      el("span", {
        class: `status-chip status-chip--${details.statusCategory}`,
        text: details.status,
      }),
      title,
    ),
    el(
      "p",
      { class: "ticket-meta" },
      "Assignee ",
      el("strong", { text: details.assignee ?? "Unassigned" }),
      " · Priority ",
      el("strong", { text: details.priority ?? "None" }),
      ...(updated === null ? [] : [" · Updated ", timeNode(updated, "")]),
    ),
  ];
}

function summaryNode(ticket, busy) {
  const focusKey = scopeOf("summarize", ticket.key);
  const summarizeHandler = (event) => {
    if (!isDisabled(event.currentTarget)) summarize(ticket.key);
  };
  const againButton = () =>
    el(
      "button",
      {
        type: "button",
        class: "again-button hit44",
        "data-focus-key": focusKey,
        "aria-disabled": String(busy),
        "aria-busy": String(busy),
        onclick: summarizeHandler,
      },
      "Summarize again",
    );
  switch (ticket.summaryStatus) {
    case "loading":
      return el("p", {
        class: "hint",
        role: "status",
        tabindex: "-1",
        "data-focus-key": focusKey,
        text: "Claude is reading the ticket…",
      });
    case "ready":
      return el(
        "div",
        { class: "summary sb-section" },
        el("p", { class: "summary-title", text: "Claude's summary" }),
        el("p", { class: "summary-text", text: ticket.summary ?? "" }),
        againButton(),
      );
    case "failed":
      return el(
        "div",
        { class: "summary" },
        el("p", { class: "field-error", text: ticket.summaryError ?? "The summary failed." }),
        againButton(),
      );
    default:
      return el(
        "div",
        { class: "summary-ask" },
        el(
          "button",
          {
            type: "button",
            class: "sb-chip summarize-button",
            "data-focus-key": focusKey,
            "aria-disabled": String(busy),
            "aria-busy": String(busy),
            onclick: summarizeHandler,
          },
          icon("summarize"),
          "Summarize with Claude",
        ),
        el("span", {
          class: "hint",
          text: "Claude reads the ticket and its latest comments only when you ask.",
        }),
      );
  }
}

function updateCardState(refs, card) {
  refs.banner.hidden = card.error === null;
  setText(refs.bannerText, card.error ?? "");
  const note = memory.notes.get(card.key);
  const working = workingMessage(card, note);
  refs.working.hidden = working === null;
  syncSection(refs.working, JSON.stringify(working), () => workNodes(working));
}

function workNodes(work) {
  if (work === null) return [];
  return [
    el("span", { class: "sb-dot working-dot", "aria-hidden": "true" }),
    el("span", {}, el("strong", { text: work.title }), work.text),
  ];
}

function workingMessage(card, note) {
  const pendingKind = card.pending?.kind;
  if (pendingKind === "propose")
    return {
      title: "Claude is drafting.",
      text: note === undefined ? "" : ` Your note: “${note}”`,
    };
  if (pendingKind === "execute" && card.actionProposal?.isRunning !== true)
    return card.proposal === null ? { title: "Sending.", text: "" } : RUNNING_STEPS_WORK;
  return null;
}

function updateApprovalControls(controls, card, scope, controlNames) {
  if (controls === null || controls === undefined) return;
  const busy = card.pending !== null || requests.inFlight.has(scope);
  setDisabled(controls.approve, busy);
  setDisabled(controls.discard, busy);
  spinOnly(
    new Map([
      [controlNames.approve, controls.approve],
      [controlNames.discard, controls.discard],
    ]),
    spinningControlOf(card),
  );
  setText(controls.error, requests.errors.get(scope) ?? "");
}

function updateProposal(refs, card) {
  refs.proposal.hidden = card.proposal === null;
  if (card.proposal === null) {
    syncSection(refs.proposal, "none", () => []);
    refs.proposalControls = null;
    return;
  }
  const note = memory.notes.get(card.key) ?? null;
  syncSection(
    refs.proposal,
    JSON.stringify([card.proposal, card.approveCloses, note, replyPlaceLabel(card, card.proposal)]),
    () => proposalNodes(card, note, refs),
  );
  updateApprovalControls(refs.proposalControls, card, scopeOf("proposal", card.key), {
    approve: CONTROLS.approve,
    discard: CONTROLS.discard,
  });
}

function approvalParts(
  proposal,
  approveCloses,
  { cardKey, texts, replyLabel, idPrefix, onApprove, onDiscard },
) {
  const approveButton = el(
    "button",
    {
      type: "button",
      class: "sb-btn button button-accent approve-button",
      onclick: (event) => !isDisabled(event.currentTarget) && onApprove(),
    },
    icon("check"),
    approveCloses ? "Approve and send" : "Approve and run",
  );
  const discardButton = el(
    "button",
    {
      type: "button",
      class: "button button-quiet discard-button",
      onclick: (event) => !isDisabled(event.currentTarget) && onDiscard(),
    },
    "Discard",
  );
  const error = errorLine();
  return {
    controls: { approve: approveButton, discard: discardButton, error },
    steps: el(
      "ol",
      { class: "steps" },
      ...proposal.steps.map((step, index) =>
        stepItem(step, index, { cardKey, texts, replyLabel, idPrefix }),
      ),
    ),
    buttons: [approveButton, discardButton],
    hint: el("span", {
      class: "hint proposal-reassure",
      text: approveCloses
        ? "Nothing is sent until you approve."
        : "Nothing runs until you approve. No reply goes out, so the card stays open.",
    }),
    error,
  };
}

function proposalNodes(card, note, refs) {
  const parts = approvalParts(card.proposal, card.approveCloses, {
    cardKey: card.key,
    texts: editsFor(memory.edits, card.key, card.proposal),
    replyLabel: replyPlaceLabel(card, card.proposal),
    idPrefix: "proposal",
    onApprove: () => approve(card.key),
    onDiscard: () => discard(card.key),
  });
  refs.proposalControls = parts.controls;
  return [
    note === null
      ? null
      : el(
          "div",
          { class: "proposal-note" },
          el("p", { class: "proposal-note-label", text: "Your note" }),
          el("p", { class: "proposal-note-text", text: `“${plainText(note)}”` }),
        ),
    el(
      "div",
      { class: "proposal-body" },
      el(
        "div",
        {},
        el("h3", { id: "proposal-heading", class: "proposal-title", text: "Claude's proposal" }),
        el("p", { class: "proposal-summary", text: card.proposal.summary }),
      ),
      parts.steps,
      el(
        "div",
        { class: "proposal-actions" },
        ...parts.buttons,
        el(
          "button",
          { type: "button", class: "button button-quiet new-note-button", onclick: focusComposer },
          "Write a new note",
        ),
        parts.hint,
      ),
      parts.error,
    ),
  ].filter((node) => node !== null);
}

function stepItem(step, index, reply) {
  const isReply = step.type === "slack_reply";
  return el(
    "li",
    { class: "step" },
    el("span", {
      class: `step-number${isReply ? " step-number--reply" : ""}`,
      "aria-hidden": "true",
      text: String(index + 1),
    }),
    el("div", { class: "step-content" }, ...stepContent(step, index, reply)),
  );
}

const issueChip = (issueKey) => el("span", { class: "key-chip", text: issueKey });
const connectorToolName = (tool) => tool.split("__").slice(2).join("__") || tool;
const stepTitle = (...parts) => el("p", { class: "step-title" }, ...parts);

function stepContent(step, index, { cardKey, texts, replyLabel, idPrefix }) {
  switch (step.type) {
    case "slack_reply": {
      const fieldId = `${idPrefix}-reply-step-${index}`;
      const field = el("textarea", {
        id: fieldId,
        class: "textarea",
        rows: "4",
        "data-focus-key": fieldId,
      });
      const mentions = mentionsFor(field, cardKey, texts.get(index) ?? step.text, (slack) =>
        texts.set(index, slack),
      );
      return [el("label", { for: fieldId, class: "step-label", text: replyLabel }), mentions.node];
    }
    case "slack_reaction":
      return [stepTitle(`React with :${String(step.emoji).replace(/^:|:$/g, "")}:`)];
    case "jira_comment":
      return [
        stepTitle("Comment on ", issueChip(step.issueKey)),
        el("p", { class: "step-body", text: step.body }),
      ];
    case "jira_transition":
      return [stepTitle("Move ", issueChip(step.issueKey), ` to ${step.status}`)];
    case "jira_assign":
      return [stepTitle("Assign ", issueChip(step.issueKey), ` to ${step.assignee}`)];
    case "jira_edit":
      return [
        stepTitle(`Change ${Object.keys(step.fields).join(", ")} on `, issueChip(step.issueKey)),
        editedFields(step.fields),
      ];
    case "tool_call":
      return [
        stepTitle("Run ", el("span", { class: "key-chip", text: connectorToolName(step.tool) })),
        el("pre", { class: "step-input", text: JSON.stringify(step.input, null, 2) }),
      ];
    default:
      return [stepTitle(`A step the board cannot show: ${String(step.type)}`)];
  }
}

function editedFields(fields) {
  return el(
    "dl",
    { class: "step-fields" },
    ...Object.entries(fields).flatMap(([name, value]) => [
      el("dt", { text: name }),
      el("dd", { text: Array.isArray(value) ? value.join(", ") : String(value) }),
    ]),
  );
}

function updateComposer(refs, card) {
  const scope = scopeOf("propose", card.key);
  const busy = card.pending !== null || requests.inFlight.has(scope);
  setDisabled(refs.draftButton, busy);
  if (refs.sendWrittenButton !== null) setDisabled(refs.sendWrittenButton, busy);
  for (const button of refs.reactionButtons) setDisabled(button, busy);
  spinOnly(
    new Map([
      [CONTROLS.draft, refs.draftButton],
      [CONTROLS.send, refs.sendWrittenButton ?? refs.draftButton],
      ...QUICK_REACTIONS.map((reaction, index) => [
        reactionControl(reaction),
        refs.reactionButtons[index],
      ]),
    ]),
    spinningControlOf(card),
  );
  setText(refs.composerStatus, card.pending === null ? "" : BUSY_MESSAGE);
  setText(refs.composerError, requests.errors.get(scope) ?? "");
}

const composeQueryText = () => dom.composeQuery.value.trim();

function openCompose() {
  clearTimeout(compose.peopleTimer);
  clearTimeout(compose.lookupTimer);
  compose.people = [];
  compose.peopleQuery = null;
  compose.error = null;
  requests.errors.delete("compose");
  dom.composeQuery.value = "";
  dom.composeDialog.showModal();
  dom.composeQuery.focus();
  renderCompose();
  void loadPeople("").catch(reportDefect);
}

function onComposeInput() {
  const query = composeQueryText();
  clearTimeout(compose.peopleTimer);
  clearTimeout(compose.lookupTimer);
  requests.errors.delete("compose");
  compose.peopleTimer = setTimeout(
    () => void loadPeople(query).catch(reportDefect),
    PEOPLE_DEBOUNCE_MS,
  );
  if (query.length >= LOOKUP_MIN_CHARS && !lookups.requested.has(query))
    compose.lookupTimer = setTimeout(
      () => void requestLookup(query, (message) => failComposeLookup(query, message)),
      LOOKUP_DEBOUNCE_MS,
    );
  renderCompose();
}

function failComposeLookup(query, message) {
  if (composeQueryText() === query) compose.error = message;
  renderCompose();
}

async function loadPeople(query) {
  const request = ++compose.peopleRequest;
  try {
    const people = readPeople(await api("GET", `/api/people?q=${encodeURIComponent(query)}`));
    if (request !== compose.peopleRequest) return;
    compose.people = people;
    compose.peopleQuery = query;
    compose.error = null;
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    if (request !== compose.peopleRequest || error.status === 401) return;
    compose.error = error.message;
  }
  renderCompose();
}

async function requestLookup(query, onFailure) {
  lookups.requested.add(query);
  try {
    await api("POST", "/api/lookup", { query });
  } catch (error) {
    if (!(error instanceof ApiError)) return reportDefect(error);
    lookups.requested.delete(query);
    if (error.status !== 401) onFailure(error.message);
    return;
  }
  void refreshNow();
}

function searchMentions(trigger, query, refresh) {
  clearTimeout(mention.peopleTimer);
  clearTimeout(mention.lookupTimer);
  const searched = trigger + query;
  mention.searched = searched;
  mention.error = null;
  mention.refresh = refresh;
  mention.peopleTimer = setTimeout(
    () => void loadMentionPeople(trigger, query),
    PEOPLE_DEBOUNCE_MS,
  );
  if (query.length >= LOOKUP_MIN_CHARS && SINGLE_WORD.test(query) && !lookups.requested.has(query))
    mention.lookupTimer = setTimeout(
      () => void requestLookup(query, (message) => failMentionSearch(searched, message)),
      LOOKUP_DEBOUNCE_MS,
    );
}

function failMentionSearch(searched, message) {
  if (mention.searched !== searched) return;
  mention.error = message;
  mention.refresh?.();
}

async function loadMentionPeople(trigger, query) {
  const request = ++mention.request;
  const kind = trigger === "#" ? "channel" : "person";
  try {
    const people = readPeople(
      await api("GET", `/api/people?q=${encodeURIComponent(query)}&kind=${kind}`),
    );
    if (request !== mention.request) return;
    mention.people = people;
    mention.loaded = trigger + query;
  } catch (error) {
    if (!(error instanceof ApiError)) return reportDefect(error);
    if (request !== mention.request || error.status === 401) return;
    mention.error = error.message;
  }
  mention.refresh?.();
}

function mentionChoicesFor(cardKey, trigger, query) {
  const card = findCard(cardKey);
  if (card === undefined) return { entries: [], error: null };
  const searched = trigger + query;
  const lookup = board.lookup?.query === query ? board.lookup : null;
  return {
    entries: mentionChoices({
      trigger,
      query,
      card,
      people: mention.loaded === searched ? mention.people : [],
      found: lookup?.results ?? [],
    }),
    error: mention.searched === searched ? (mention.error ?? lookup?.error ?? null) : null,
  };
}

function mentionsFor(textarea, cardKey, slack, onChange) {
  return mentionField({
    textarea,
    slack,
    onChange,
    nameOf: knownName,
    announce,
    choices: (trigger, query) => mentionChoicesFor(cardKey, trigger, query),
    onSearch: searchMentions,
  });
}

function currentLookup() {
  const lookup = board.lookup;
  return lookup !== null && lookup.query === composeQueryText() ? lookup : null;
}

function rerunLookupMerge() {
  if (!dom.composeDialog.open) return;
  const lookup = currentLookup();
  if (lookup === null) return;
  const signature = JSON.stringify([lookup.query, lookup.results]);
  if (signature === compose.lookupSignature) return;
  compose.lookupSignature = signature;
  void loadPeople(lookup.query).catch(reportDefect);
}

function mergedRecipients() {
  const lookup = currentLookup();
  const merged = new Map();
  for (const recipient of [...compose.people, ...(lookup?.results ?? [])])
    if (!merged.has(recipient.channelId)) merged.set(recipient.channelId, recipient);
  return [...merged.values()];
}

function composeStatusText(query, results) {
  if (compose.peopleQuery === null) return "Searching…";
  const lookupPending = lookups.requested.has(query) && currentLookup() === null;
  if (results.length === 0 && !lookupPending)
    return query === "" ? "No recent people yet." : `No person or channel matches “${query}”.`;
  return lookupPending ? "Searching Slack for more matches…" : "";
}

function renderCompose() {
  if (!dom.composeDialog.open) return;
  const query = composeQueryText();
  const results = mergedRecipients();
  setText(dom.composeStatus, composeStatusText(query, results));
  setText(
    dom.composeError,
    requests.errors.get("compose") ?? compose.error ?? currentLookup()?.error ?? "",
  );
  syncSection(dom.composeResults, JSON.stringify(results), () =>
    results.map((recipient, index) => resultItem(recipient, index === 0)),
  );
  for (const button of dom.composeResults.querySelectorAll("button"))
    setDisabled(button, requests.inFlight.has("compose"));
}

function resultItem(recipient, first) {
  const isChannel = recipient.kind === "channel";
  const mark = isChannel
    ? el("span", { class: "avatar avatar--40 avatar--square", "aria-hidden": "true", text: "#" })
    : avatar(recipient.label, "avatar--40");
  if (isChannel) mark.style.backgroundColor = CHANNEL_AVATAR_COLOUR;
  return el(
    "li",
    {},
    el(
      "button",
      {
        type: "button",
        class: first ? "result result--first" : "result",
        "data-focus-key": scopeOf("result", recipient.channelId),
        onclick: (event) => !isDisabled(event.currentTarget) && void chooseRecipient(recipient),
        onkeydown: onResultKeydown,
      },
      mark,
      el("span", { class: "result-label", text: recipient.label }),
      el("span", { class: "result-kind", text: isChannel ? "Channel" : "Person" }),
    ),
  );
}

function resultButtons() {
  return [...dom.composeResults.querySelectorAll("button")];
}

function onComposeKeydown(event) {
  const [first] = resultButtons();
  if (first === undefined) return;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    first.focus();
  } else if (event.key === "Enter") {
    event.preventDefault();
    first.click();
  }
}

function onResultKeydown(event) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  const buttons = resultButtons();
  const index = buttons.indexOf(event.currentTarget);
  const next = event.key === "ArrowDown" ? buttons[index + 1] : buttons[index - 1];
  if (next !== undefined) next.focus();
  else if (event.key === "ArrowUp") dom.composeQuery.focus();
}

async function chooseRecipient(recipient) {
  await runAction(
    "compose",
    () => api("POST", "/api/compose", { channelId: recipient.channelId, label: recipient.label }),
    {
      onSuccess: (payload) => {
        ui.pendingOpenKey = readComposeKey(payload);
        dom.composeDialog.close();
      },
    },
  );
}

function onComposeClosed() {
  if (dom.composeDialog.open) return;
  clearTimeout(compose.peopleTimer);
  clearTimeout(compose.lookupTimer);
  compose.peopleRequest += 1;
  if (ui.pendingOpenKey === null) dom.composeButton.focus();
}

function focusableIn(container) {
  return [
    ...container.querySelectorAll(
      'a[href], button, textarea, input, select, [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((node) => !node.disabled && node.getClientRects().length > 0);
}

function trapFocus(event) {
  if (event.key !== "Tab") return;
  const focusables = focusableIn(event.currentTarget);
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables.at(-1);
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !focusables.includes(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

function closeOnBackdrop(event) {
  if (event.target === event.currentTarget) event.currentTarget.close();
}

function signOut() {
  board.token = null;
  storeToken(null);
  showSignedOut();
}

function showSignedOut() {
  board.signedOut = true;
  clearTimeout(board.pollTimer);
  if (dom.composeDialog.open) dom.composeDialog.close();
  closeDetail();
  dom.app.hidden = true;
  dom.signedOut.hidden = false;
}

function showApp() {
  board.signedOut = false;
  dom.signedOut.hidden = true;
  dom.app.hidden = false;
  render();
  void refreshNow();
}

function adoptFragmentToken() {
  const token = takeFragmentToken();
  if (token === null) return;
  board.token = token;
  if (board.signedOut) showApp();
  else void refreshNow();
}

function bindEvents() {
  for (const button of dom.themeButtons)
    button.addEventListener("click", () => setTheme(button.dataset.themeOption));
  for (const button of dom.viewButtons)
    button.addEventListener("click", () => setView(button.dataset.viewOption));
  darkScheme.addEventListener("change", applyTheme);
  dom.syncButton.addEventListener("click", () => !isDisabled(dom.syncButton) && requestSync());
  dom.notifyButton.addEventListener(
    "click",
    () => !isDisabled(dom.notifyButton) && void requestNotifications().catch(reportDefect),
  );
  dom.composeButton.addEventListener("click", openCompose);
  dom.channelSelect.addEventListener("change", () => setFilter("channel", dom.channelSelect.value));
  dom.personSelect.addEventListener("change", () => setFilter("person", dom.personSelect.value));
  dom.prioritySelect.addEventListener("change", () =>
    setFilter("priority", dom.prioritySelect.value),
  );
  dom.sortSelect.addEventListener("change", () => setSort(dom.sortSelect.value));
  dom.sortDirection.addEventListener("click", toggleSortDirection);
  dom.groupSelect.addEventListener("change", () => setGroup(dom.groupSelect.value));
  dom.search.addEventListener("input", () => setQuery(dom.search.value));
  dom.search.addEventListener("keydown", onSearchKeydown);
  dom.searchClear.addEventListener("click", () => {
    setQuery("");
    dom.search.focus();
  });
  dom.filtersButton.addEventListener("click", () =>
    ui.filtersOpen ? closeFilters({ returnFocus: true }) : openFilters(),
  );
  dom.filtersPanel.addEventListener("keydown", onFiltersKeydown);
  dom.filtersDone.addEventListener("click", () => closeFilters({ returnFocus: true }));
  dom.clearFilters.addEventListener("click", () => clearFilters(focusFirstTypeChip));
  dom.clearAll.addEventListener("click", () => clearFilters(() => dom.filtersButton.focus()));
  dom.emptyClear.addEventListener("click", clearSearchAndFilters);
  dom.otherToggle.addEventListener("click", toggleOtherMessages);
  dom.otherReadAll.addEventListener(
    "click",
    () => !isDisabled(dom.otherReadAll) && markAllOtherRead(),
  );
  document.addEventListener("pointerdown", onOutsidePointer);
  document.addEventListener("keydown", onShortcutKeydown);
  for (const dialog of [dom.detailDialog, dom.composeDialog]) {
    dialog.addEventListener("keydown", trapFocus);
    dialog.addEventListener("click", closeOnBackdrop);
  }
  dom.detailDialog.addEventListener("close", onDetailClosed);
  dom.composeDialog.addEventListener("close", onComposeClosed);
  dom.composeClose.addEventListener("click", () => dom.composeDialog.close());
  dom.composeQuery.addEventListener("input", onComposeInput);
  dom.composeQuery.addEventListener("keydown", onComposeKeydown);
  document.addEventListener("focusout", queueRender);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clearTimeout(board.pollTimer);
    else if (!board.signedOut) void refreshNow();
  });
  window.addEventListener("hashchange", adoptFragmentToken);
  setInterval(() => {
    refreshTimes();
    renderHeader();
  }, TIME_REFRESH_MS);
}

function start() {
  bindEvents();
  applyTheme();
  board.token = takeFragmentToken() ?? readStoredToken();
  if (board.token === null) showSignedOut();
  else {
    showApp();
    void askForNotificationsOnOpen().catch(reportDefect);
  }
}

start();
