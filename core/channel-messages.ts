import { authorNameOf, compareTs, conversationKey, isNewer } from "./inbox.ts";
import type { ChannelMessage, SlackHit } from "./types.ts";

export type ChannelSync = {
  stored: ChannelMessage[];
  hits: SlackHit[];
  me: string;
  covered: ReadonlySet<string>;
  readThrough: ReadonlyMap<string, string>;
  keepFromTs: string;
};

const isPostedToChannel = (hit: SlackHit): boolean =>
  hit.kind === "channel" && (hit.threadTs === null || hit.threadTs === hit.ts);

const channelMessageOf = (hit: SlackHit): ChannelMessage => ({
  key: conversationKey(hit),
  channelId: hit.channelId,
  channelLabel: hit.channelLabel,
  ts: hit.ts,
  authorName: authorNameOf(hit),
  text: hit.text,
  permalink: hit.permalink,
});

const isUnread = (message: ChannelMessage, readThrough: ReadonlyMap<string, string>): boolean =>
  isNewer(message.ts, readThrough.get(message.channelId));

export const unreadChannelMessages = (
  messages: ChannelMessage[],
  readThrough: ReadonlyMap<string, string>,
): ChannelMessage[] => messages.filter((message) => isUnread(message, readThrough));

export const channelMessagesAfterSync = ({
  stored,
  hits,
  me,
  covered,
  readThrough,
  keepFromTs,
}: ChannelSync): ChannelMessage[] => {
  const fresh = hits
    .filter((hit) => isPostedToChannel(hit) && hit.author.id !== me)
    .map(channelMessageOf);
  const byKey = new Map([...stored, ...fresh].map((message) => [message.key, message]));
  return [...byKey.values()]
    .filter(
      (message) =>
        !covered.has(message.key) &&
        isUnread(message, readThrough) &&
        compareTs(message.ts, keepFromTs) >= 0,
    )
    .sort((left, right) => compareTs(left.ts, right.ts));
};
