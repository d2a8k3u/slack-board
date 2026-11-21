import { compareTs } from "./inbox.ts";
import type { HistoryMessage } from "./types.ts";

type RawHistory = { messages: string };

const SECTION_MARKER = /^(?:=== .* ===\s*|--- Reply \d+ of \d+ ---|No thread messs?ages)$/gm;
const THREAD_AUTHOR = /^From: (.*?)(?: <[^>]*>)? \((\w+)\)\s*$/m;
const CHANNEL_AUTHOR = /^=== Message from (.*?)(?: <[^>]*>)? \((\w+)\) at .*===\s*$/;
const MESSAGE_TS = /^Message TS: (\d+\.\d+)\s*$/m;
const REACTIONS_LINE = /\nReactions: .*$/;

const isRawHistory = (value: unknown): value is RawHistory =>
  typeof value === "object" && value !== null && typeof (value as RawHistory).messages === "string";

const parseRawHistory = (raw: string): RawHistory => {
  const parsed: unknown = (() => {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  })();
  if (!isRawHistory(parsed))
    throw new Error(
      `Slack returned something that is not a Slack message history: ${raw.slice(0, 200)}`,
    );
  return parsed;
};

const sectionsOf = (messages: string): string[] => {
  const starts = [...messages.matchAll(SECTION_MARKER)].map((match) => match.index);
  return starts.map((start, index) => messages.slice(start, starts[index + 1]));
};

const messageOf = (section: string): HistoryMessage | null => {
  const ts = MESSAGE_TS.exec(section);
  if (ts === null) return null;
  const author =
    CHANNEL_AUTHOR.exec(section.split("\n", 1)[0] ?? "") ?? THREAD_AUTHOR.exec(section);
  if (author === null)
    throw new Error(`Slack message history has no author: ${section.slice(0, 200)}`);
  return {
    ts: ts[1] ?? "",
    authorId: author[2] ?? null,
    authorName: author[1]?.trim() ?? "",
    text: section
      .slice(ts.index + ts[0].length)
      .trim()
      .replace(REACTIONS_LINE, ""),
  };
};

export const readHistory = (raw: string): HistoryMessage[] =>
  sectionsOf(parseRawHistory(raw).messages)
    .map(messageOf)
    .filter((message) => message !== null)
    .sort((left, right) => compareTs(left.ts, right.ts));
