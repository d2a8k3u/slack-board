import type { CardPriority, Priority } from "./types.ts";

export const MAX_REASON_CHARS = 120;

export const PRIORITIES: readonly Priority[] = ["decision", "action", "info", "social"];

type RankedItem = { card?: unknown; priority?: unknown; reason?: unknown };

const listIn = (answer: string): unknown[] => {
  const start = answer.indexOf("[");
  const end = answer.lastIndexOf("]");
  const parsed: unknown = (() => {
    if (start === -1 || end < start) return null;
    try {
      return JSON.parse(answer.slice(start, end + 1));
    } catch {
      return null;
    }
  })();
  if (!Array.isArray(parsed))
    throw new Error(`Claude answered with no list of priorities: ${answer.slice(0, 200)}`);
  return parsed;
};

const isPriority = (value: unknown): value is Priority =>
  typeof value === "string" && (PRIORITIES as readonly string[]).includes(value);

const keyOf = (item: RankedItem, cardKeys: string[]): string | undefined =>
  typeof item.card === "number" && Number.isInteger(item.card)
    ? cardKeys[item.card - 1]
    : undefined;

export const parsePriorities = (answer: string, cardKeys: string[]): CardPriority[] =>
  listIn(answer)
    .filter((item): item is RankedItem => typeof item === "object" && item !== null)
    .flatMap((item) => {
      const key = keyOf(item, cardKeys);
      if (key === undefined || !isPriority(item.priority)) return [];
      return [
        {
          key,
          priority: item.priority,
          reason: (typeof item.reason === "string" ? item.reason.trim() : "").slice(
            0,
            MAX_REASON_CHARS,
          ),
        },
      ];
    });
