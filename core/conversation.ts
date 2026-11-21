import { compareTs } from "./inbox.ts";
import type { ConversationMessage, HistoryMessage } from "./types.ts";

const onceByTs = (messages: HistoryMessage[]): HistoryMessage[] => {
  const byTs = new Map<string, HistoryMessage>();
  for (const { ts, authorId, authorName, text } of messages)
    if (!byTs.has(ts)) byTs.set(ts, { ts, authorId, authorName, text });
  return [...byTs.values()].sort((left, right) => compareTs(left.ts, right.ts));
};

export const conversationView = (
  history: HistoryMessage[],
  waiting: HistoryMessage[],
  me: string | null,
): ConversationMessage[] => {
  const messages = onceByTs([...history, ...waiting]);
  const isMine = (message: HistoryMessage) => me !== null && message.authorId === me;
  const lastMine = messages.findLastIndex(isMine);
  return messages.map((message, index) => ({
    ...message,
    isMine: isMine(message),
    startsNew: lastMine !== -1 && index === lastMine + 1,
  }));
};
