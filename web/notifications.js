import { slackTokens } from "./slack-text.js";

export const NOTICE_TEXT_CHARS = 100;
export const MESSAGE_NOTICE_LIMIT = 3;

const ELLIPSIS = "…";
const BOARD_TITLE = "Slack Board";
const NAMED_AUTHORS = 2;

const noticeText = (text) => {
  const plain = slackTokens(text)
    .map((token) => token.text)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  const characters = Array.from(plain);
  return characters.length <= NOTICE_TEXT_CHARS
    ? plain
    : `${characters.slice(0, NOTICE_TEXT_CHARS - 1).join("")}${ELLIPSIS}`;
};

const notice = (event, tag, title, text, cardKey) => ({
  event,
  tag,
  title,
  body: noticeText(text),
  cardKey,
});

const placeTitle = ({ kind, title, message }) => {
  if (kind === "channel") return `${message.authorName} in ${title}`;
  if (kind === "group") return title;
  return message.authorName;
};

const latestPerConversation = (items) => [
  ...new Map(items.map((entry) => [entry.cardKey, entry])).values(),
];

const authorList = (names) => {
  if (names.length <= NAMED_AUTHORS) return names.join(" and ");
  const rest = names.length - NAMED_AUTHORS;
  return `${names.slice(0, NAMED_AUTHORS).join(", ")} and ${rest} ${rest === 1 ? "other" : "others"}`;
};

export function newsNotices(previous, next) {
  if (next === null || next.at === previous?.at) return [];
  const latest = latestPerConversation(next.items);
  if (latest.length <= MESSAGE_NOTICE_LIMIT)
    return latest.map((entry) =>
      notice(
        "newMessages",
        `message:${entry.cardKey}`,
        placeTitle(entry),
        entry.message.text,
        entry.cardKey,
      ),
    );
  const authors = [...new Set(next.items.map((entry) => entry.message.authorName))];
  return [
    notice(
      "newMessages",
      "messages",
      BOARD_TITLE,
      `${next.items.length} new messages from ${authorList(authors)}`,
      null,
    ),
  ];
}

const changeNotice = (change) => {
  const { card } = change;
  const about = (event, text) => notice(event, `card:${card.key}`, card.title, text, card.key);
  switch (change.kind) {
    case "proposal":
      return about("claudeDone", "Proposal ready to approve");
    case "answered": {
      const turn = card.actions.at(-1);
      return about(
        "claudeDone",
        turn?.isFailed === true
          ? `Claude could not finish your prompt: ${turn.text}`
          : "Claude answered your prompt",
      );
    }
    case "failed":
      return change.work === "propose"
        ? about("claudeDone", `Claude could not draft: ${change.error}`)
        : about("sendFailed", `Not sent: ${change.error}`);
    default:
      return null;
  }
};

export const cardNotices = (changes) => changes.map(changeNotice).filter((entry) => entry !== null);

export const syncNotices = (previous, next) =>
  next.lastError === null || previous.lastError !== null
    ? []
    : [notice("syncFailed", "sync", "Slack sync failed", next.lastError, null)];
