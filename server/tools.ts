import { checkProposal } from "../core/proposal.ts";
import type { FinishOutcome, SlackHit } from "../core/types.ts";
import type { BoardStore } from "./store.ts";

export type ToolContext = { store: BoardStore; projectKeys: string[]; boardUrl: () => string };

type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  run: (args: Record<string, unknown>, context: ToolContext) => unknown;
};

const INTERNAL = "Internal to the slack-board plugin hooks. Never call it yourself.";
const MAX_ERROR_CHARS = 2000;

class ToolInputError extends Error {}

const text = (args: Record<string, unknown>, name: string): string => {
  const value = args[name];
  if (typeof value !== "string" || value === "")
    throw new ToolInputError(`${name} must be non-empty text`);
  return value;
};

const number = (args: Record<string, unknown>, name: string): number => {
  const value = args[name];
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new ToolInputError(`${name} must be a number`);
  return value;
};

const flag = (args: Record<string, unknown>, name: string): boolean => {
  const value = args[name];
  if (typeof value !== "boolean") throw new ToolInputError(`${name} must be true or false`);
  return value;
};

const hits = (args: Record<string, unknown>, name: string): SlackHit[] => {
  const value = args[name];
  if (!Array.isArray(value)) throw new ToolInputError(`${name} must be a list of Slack hits`);
  return value as SlackHit[];
};

const outcomeOf = (value: unknown, projectKeys: string[]): FinishOutcome => {
  if (typeof value !== "object" || value === null)
    throw new ToolInputError("outcome must be an object");
  const outcome = value as FinishOutcome;
  if (!outcome.ok) return { ...outcome, error: String(outcome.error).slice(0, MAX_ERROR_CHARS) };
  if (outcome.proposal === undefined) return outcome;
  const check = checkProposal(outcome.proposal, projectKeys);
  return check.ok
    ? { ...outcome, proposal: check.proposal }
    : { ok: false, error: `Claude proposed something not allowed: ${check.reason}` };
};

export const TOOLS: ToolDefinition[] = [
  {
    name: "board_url",
    description:
      "The private link that opens the Slack Board in a browser. Only the /board command needs it; never show it in chat.",
    inputSchema: { type: "object", properties: {} },
    run: (_args, context) => context.boardUrl(),
  },
  {
    name: "list_cards",
    description:
      "Lists the open cards on the Slack Board: who wrote, where, the latest message and any proposal waiting for approval.",
    inputSchema: { type: "object", properties: {} },
    run: (_args, { store }) =>
      store.cards().map((card) => ({
        title: card.title,
        kind: card.kind,
        latest: card.messages.at(-1)?.text ?? null,
        messages: card.messages.length,
        tickets: card.tickets.map((ticket) => ticket.key),
        priority: card.priority,
        proposal: card.proposal?.summary ?? null,
        actionProposal: card.actionProposal?.proposal.summary ?? null,
        error: card.error,
      })),
  },
  {
    name: "take_request",
    description: INTERNAL,
    inputSchema: {
      type: "object",
      properties: { worker: { type: "string" } },
      required: ["worker"],
    },
    run: (args, { store }) => store.claim(text(args, "worker"), new Date()),
  },
  {
    name: "finish_request",
    description: INTERNAL,
    inputSchema: {
      type: "object",
      properties: { id: { type: "number" }, outcome: { type: "object" } },
      required: ["id", "outcome"],
    },
    run: (args, { store, projectKeys }) => {
      store.finish(number(args, "id"), outcomeOf(args.outcome, projectKeys), new Date());
      return "ok";
    },
  },
  {
    name: "begin_sync",
    description: INTERNAL,
    inputSchema: {
      type: "object",
      properties: {
        holder: { type: "string" },
        ttlMs: { type: "number" },
        lookbackDays: { type: "number" },
        force: { type: "boolean" },
      },
      required: ["holder", "ttlMs", "lookbackDays"],
    },
    run: (args, { store }) => {
      const now = new Date();
      const granted =
        args.force === true ||
        store.acquireSyncLease(text(args, "holder"), now, number(args, "ttlMs"));
      return {
        granted,
        after: Math.floor(
          store.syncWindowStart(now, number(args, "lookbackDays")).getTime() / 1000,
        ),
        startedAt: now.toISOString(),
      };
    },
  },
  {
    name: "ingest",
    description: INTERNAL,
    inputSchema: {
      type: "object",
      properties: {
        hits: { type: "array" },
        myHits: { type: "array" },
        channelHits: { type: "array" },
        hasMoreChannelHits: { type: "boolean" },
        lookbackDays: { type: "number" },
        me: { type: "string" },
        syncedAt: { type: "string" },
      },
      required: [
        "hits",
        "myHits",
        "channelHits",
        "hasMoreChannelHits",
        "lookbackDays",
        "me",
        "syncedAt",
      ],
    },
    run: (args, { store, projectKeys }) => {
      const news = store.ingest({
        hits: hits(args, "hits"),
        myHits: hits(args, "myHits"),
        channelHits: hits(args, "channelHits"),
        hasMoreChannelHits: flag(args, "hasMoreChannelHits"),
        me: text(args, "me"),
        projectKeys,
        syncedAt: new Date(text(args, "syncedAt")),
        lookbackDays: number(args, "lookbackDays"),
      });
      return {
        cards: store.cards().length,
        rankingBatches: store.requestRanking(new Date()),
        news,
      };
    },
  },
  {
    name: "fail_sync",
    description: INTERNAL,
    inputSchema: { type: "object", properties: { error: { type: "string" } }, required: ["error"] },
    run: (args, { store }) => {
      store.failSync(text(args, "error").slice(0, MAX_ERROR_CHARS));
      return "ok";
    },
  },
];

export const runTool = (
  name: string,
  args: Record<string, unknown>,
  context: ToolContext,
): { text: string; isError: boolean } => {
  const tool = TOOLS.find((candidate) => candidate.name === name);
  if (tool === undefined) return { text: `No tool named ${name}`, isError: true };
  try {
    const result = tool.run(args, context);
    return { text: typeof result === "string" ? result : JSON.stringify(result), isError: false };
  } catch (error) {
    if (error instanceof ToolInputError) return { text: error.message, isError: true };
    throw error;
  }
};
