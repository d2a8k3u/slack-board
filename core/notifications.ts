import { slackTokens } from "../web/slack-text.js";
import type { FinishOutcome, NewMessage, RequestKind } from "./types.ts";

export type NoticeEvent = "newMessages" | "claudeDone" | "sendFailed" | "syncFailed";
export type Notice = { event: NoticeEvent; key: string; title: string; text: string };

export const NOTICE_TEXT_CHARS = 100;
export const MESSAGE_NOTICE_LIMIT = 3;

const ELLIPSIS = "…";
const BOARD_TITLE = "Slack Board";
const NAMED_AUTHORS = 2;

const noticeText = (text: string): string => {
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

const placeTitle = ({ kind, title, message }: NewMessage): string => {
  switch (kind) {
    case "dm":
      return message.authorName;
    case "group":
      return title;
    case "channel":
      return `${message.authorName} in ${title}`;
  }
};

const latestPerConversation = (news: NewMessage[]): NewMessage[] => [
  ...new Map(news.map((entry) => [entry.cardKey, entry])).values(),
];

const authorList = (names: string[]): string => {
  if (names.length <= NAMED_AUTHORS) return names.join(" and ");
  const rest = names.length - NAMED_AUTHORS;
  return `${names.slice(0, NAMED_AUTHORS).join(", ")} and ${rest} ${rest === 1 ? "other" : "others"}`;
};

export const newMessageNotices = (news: NewMessage[]): Notice[] => {
  const latest = latestPerConversation(news);
  if (latest.length <= MESSAGE_NOTICE_LIMIT)
    return latest.map((entry) => ({
      event: "newMessages",
      key: `message:${entry.cardKey}`,
      title: placeTitle(entry),
      text: noticeText(entry.message.text),
    }));
  const authors = [...new Set(news.map((entry) => entry.message.authorName))];
  return [
    {
      event: "newMessages",
      key: "messages",
      title: BOARD_TITLE,
      text: `${news.length} new messages from ${authorList(authors)}`,
    },
  ];
};

export const finishNotice = (
  kind: RequestKind,
  outcome: FinishOutcome,
  card: { key: string; title: string },
): Notice | null => {
  const notice = (event: NoticeEvent, text: string): Notice => ({
    event,
    key: `card:${card.key}`,
    title: card.title,
    text: noticeText(text),
  });
  switch (kind) {
    case "propose":
      return notice(
        "claudeDone",
        outcome.ok ? "Draft ready to approve" : `Claude could not draft: ${outcome.error}`,
      );
    case "act":
      return notice(
        "claudeDone",
        outcome.ok
          ? "Claude answered your prompt"
          : `Claude could not finish your prompt: ${outcome.error}`,
      );
    case "execute":
      return outcome.ok ? null : notice("sendFailed", `Not sent: ${outcome.error}`);
    default:
      return null;
  }
};

export const syncFailureNotice = (error: string): Notice => ({
  event: "syncFailed",
  key: "sync",
  title: "Slack sync failed",
  text: noticeText(error),
});
