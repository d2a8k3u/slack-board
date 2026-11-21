import type { ConversationKind, Person, Recipient, SearchPage, SlackHit } from "./types.ts";

type RawPage = { results: string; pagination_info?: string };

const RESULT_HEADER = /^### Result \d+ of \d+$/m;
const BLOCK_END = /\n\n---\s*$/;
const CURSOR = /cursor `([^`]+)`/;
const PERSON = /^(.*?) \(ID: (\w+)\)$/;
const AUTHOR = /^From: (.*?)(?: <[^>]*>)? \(ID: (\w+)\)\s*(\[BOT\])?\s*$/m;
const TEXT_START = /^Text: ?\n/m;

const isRawPage = (value: unknown): value is RawPage =>
  typeof value === "object" && value !== null && typeof (value as RawPage).results === "string";

const parseRawPage = (raw: string): RawPage => {
  const parsed: unknown = (() => {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  })();
  if (!isRawPage(parsed))
    throw new Error(
      `Slack returned something that is not a Slack search result: ${raw.slice(0, 200)}`,
    );
  return parsed;
};

const field = (block: string, name: string): string | null => {
  const match = new RegExp(`^${name}: (.*)$`, "m").exec(block);
  return match?.[1]?.trim() ?? null;
};

const requiredField = (block: string, name: string): string => {
  const value = field(block, name);
  if (value === null) throw new Error(`Slack search result has no ${name}: ${block.slice(0, 200)}`);
  return value;
};

const parsePeople = (line: string | null): Person[] =>
  (line ?? "")
    .split(/,\s*(?=[^,]*\(ID: )/)
    .map((part) => PERSON.exec(part.trim()))
    .filter((match) => match !== null)
    .map((match) => ({ name: match[1] ?? "", id: match[2] ?? "" }));

const kindOf = (channelId: string, participants: Person[]): ConversationKind => {
  if (participants.length === 0) return "channel";
  return channelId.startsWith("D") ? "dm" : "group";
};

const permalinkOf = (block: string): string => {
  const line = requiredField(block, "Permalink");
  return /\((.*)\)$/.exec(line)?.[1] ?? line;
};

const textOf = (block: string): string => {
  const start = TEXT_START.exec(block);
  if (start === null) return "";
  return block
    .slice(start.index + start[0].length)
    .replace(BLOCK_END, "")
    .trim();
};

const parseHit = (block: string): SlackHit => {
  const channel = PERSON.exec(requiredField(block, "Channel"));
  if (channel === null)
    throw new Error(`Slack search result has no channel ID: ${block.slice(0, 200)}`);
  const author = AUTHOR.exec(block);
  if (author === null) throw new Error(`Slack search result has no author: ${block.slice(0, 200)}`);
  const channelId = channel[2] ?? "";
  const participants = parsePeople(field(block, "Participants"));
  const permalink = permalinkOf(block);
  return {
    channelId,
    channelLabel: channel[1] ?? "",
    kind: kindOf(channelId, participants),
    participants,
    author: { name: author[1]?.trim() ?? "", id: author[2] ?? "" },
    isBot: author[3] !== undefined,
    ts: requiredField(block, "Message_ts"),
    threadTs: new URL(permalink).searchParams.get("thread_ts"),
    permalink,
    text: textOf(block),
  };
};

const USER_LINE = /^\d+\. (.+?) - (U[A-Z0-9]+)\b/gm;
const CHANNEL_LINE = /^\d+\. (#\S+) \(([CG][A-Z0-9]+)\)/gm;

const recipientsIn = (raw: string, line: RegExp, kind: Recipient["kind"]): Recipient[] =>
  [...parseRawPage(raw).results.matchAll(line)].map((match) => ({
    channelId: match[2] ?? "",
    label: match[1] ?? "",
    kind,
  }));

export const readRecipients = (usersRaw: string, channelsRaw: string): Recipient[] => [
  ...recipientsIn(usersRaw, USER_LINE, "person"),
  ...recipientsIn(channelsRaw, CHANNEL_LINE, "channel"),
];

export const readSearchPage = (raw: string): SearchPage => {
  const page = parseRawPage(raw);
  const blocks = page.results.split(RESULT_HEADER).slice(1);
  return {
    hits: blocks.map(parseHit),
    cursor: CURSOR.exec(page.pagination_info ?? "")?.[1] ?? null,
  };
};
