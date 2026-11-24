import type {
  CardMessage,
  IgnoredConversations,
  InboxCard,
  NewMessage,
  Recipient,
  ReplyTarget,
  SlackHit,
} from "./types.ts";

export const threadTargetFor = (target: ReplyTarget, messageTs: string | null): ReplyTarget => {
  if (messageTs === null || target.threadTs !== null) return target;
  return { channelId: target.channelId, threadTs: messageTs };
};

export const peopleFromHits = (hits: SlackHit[], me: string): Recipient[] => {
  const byId = new Map<string, Recipient>();
  for (const hit of hits) {
    if (!isFromOthers(hit, me)) continue;
    if (!byId.has(hit.author.id))
      byId.set(hit.author.id, { channelId: hit.author.id, label: hit.author.name, kind: "person" });
    if (hit.kind === "channel" && !byId.has(hit.channelId))
      byId.set(hit.channelId, {
        channelId: hit.channelId,
        label: hit.channelLabel,
        kind: "channel",
      });
  }
  const people = [...byId.values()];
  return [
    ...people.filter((entry) => entry.kind === "person"),
    ...people.filter((entry) => entry.kind === "channel"),
  ];
};

type Conversation = Omit<InboxCard, "messages">;

const TS_FRACTION_DIGITS = 6;

const tsParts = (ts: string): [number, string] => {
  const [seconds = "0", fraction = ""] = ts.split(".");
  return [Number(seconds), fraction.padEnd(TS_FRACTION_DIGITS, "0")];
};

export const compareTs = (left: string, right: string): number => {
  const [leftSeconds, leftFraction] = tsParts(left);
  const [rightSeconds, rightFraction] = tsParts(right);
  if (leftSeconds !== rightSeconds) return leftSeconds - rightSeconds;
  return leftFraction.localeCompare(rightFraction);
};

export const isNewer = (ts: string, than: string | undefined): boolean =>
  than === undefined || compareTs(ts, than) > 0;

const titleOf = (hit: SlackHit, me: string): string => {
  if (hit.kind === "channel") return hit.channelLabel;
  const others = hit.participants.filter((person) => person.id !== me).map((person) => person.name);
  return others.length > 0 ? others.join(", ") : hit.author.name;
};

const targetOf = (hit: SlackHit): ReplyTarget => {
  if (hit.kind === "channel") return { channelId: hit.channelId, threadTs: hit.threadTs ?? hit.ts };
  return { channelId: hit.channelId, threadTs: hit.threadTs };
};

export const conversationKey = (hit: SlackHit): string => {
  const target = targetOf(hit);
  return target.threadTs === null ? target.channelId : `${target.channelId}:${target.threadTs}`;
};

const conversationOf = (hit: SlackHit, me: string): Conversation => ({
  key: conversationKey(hit),
  kind: hit.kind,
  title: titleOf(hit, me),
  target: targetOf(hit),
});

const NAMELESS_APP = "Slack app";

export const authorNameOf = (hit: SlackHit): string =>
  hit.author.name === "" ? NAMELESS_APP : hit.author.name;

const messageOf = (hit: SlackHit): CardMessage => ({
  ts: hit.ts,
  authorId: hit.author.id,
  authorName: authorNameOf(hit),
  text: hit.text,
  permalink: hit.permalink,
});

const isFromOthers = (hit: SlackHit, me: string): boolean => hit.author.id !== me && !hit.isBot;

const mentionsMe = (text: string, me: string): boolean =>
  text.includes(`<@${me}>`) || text.includes(`<@${me}|`);

const isForMe = (hit: SlackHit, me: string): boolean =>
  isFromOthers(hit, me) || (hit.isBot && mentionsMe(hit.text, me));

const EVERYONE_MENTION = /<!(?:here|channel|everyone)(?:\|[^>]*)?>/;

export const mentionsEveryone = (text: string): boolean => EVERYONE_MENTION.test(text);

const withMessage = (card: InboxCard, message: CardMessage): InboxCard => {
  if (card.messages.some((existing) => existing.ts === message.ts)) return card;
  return { ...card, messages: [...card.messages, message].sort((a, b) => compareTs(a.ts, b.ts)) };
};

export const mergeHits = (
  cards: InboxCard[],
  hits: SlackHit[],
  me: string,
  ignored: IgnoredConversations,
): InboxCard[] => {
  const byKey = new Map(cards.map((card) => [card.key, card]));
  for (const hit of hits) {
    if (!isForMe(hit, me)) continue;
    const conversation = conversationOf(hit, me);
    if (!isNewer(hit.ts, ignored.get(conversation.key))) continue;
    const card = byKey.get(conversation.key) ?? { ...conversation, messages: [] };
    byKey.set(conversation.key, withMessage(card, messageOf(hit)));
  }
  return [...byKey.values()];
};

export const hitsInFollowedConversations = (
  hits: SlackHit[],
  cards: InboxCard[],
  ignored: IgnoredConversations,
): SlackHit[] => {
  const followed = new Set([...cards.map((card) => card.key), ...ignored.keys()]);
  return hits.filter((hit) => followed.has(conversationKey(hit)));
};

const latestReplyByConversation = (myHits: SlackHit[]): Map<string, string> => {
  const latest = new Map<string, string>();
  for (const hit of myHits) {
    const key = conversationKey(hit);
    if (isNewer(hit.ts, latest.get(key))) latest.set(key, hit.ts);
  }
  return latest;
};

export const newMessages = (before: InboxCard[], after: InboxCard[]): NewMessage[] => {
  const knownTs = new Map(
    before.map((card) => [card.key, new Set(card.messages.map((message) => message.ts))]),
  );
  return after.flatMap((card) =>
    card.messages
      .filter((message) => knownTs.get(card.key)?.has(message.ts) !== true)
      .map((message) => ({ cardKey: card.key, kind: card.kind, title: card.title, message })),
  );
};

export const dropAnswered = (cards: InboxCard[], myHits: SlackHit[]): InboxCard[] => {
  const latestReply = latestReplyByConversation(myHits);
  return cards
    .map((card) => {
      const replyTs = latestReply.get(card.key);
      return replyTs === undefined
        ? card
        : { ...card, messages: card.messages.filter((message) => isNewer(message.ts, replyTs)) };
    })
    .filter((card) => card.messages.length > 0);
};
