import { connectorToolParts } from "./connectors.ts";
import { NoAnswer, parseActionAnswer } from "./proposal.ts";
import type { FinishOutcome } from "./types.ts";

export const ACTION_LIMIT_MINUTES = 10;
export const ACTION_LIMIT_MS = ACTION_LIMIT_MINUTES * 60_000;

export type ActionRun = { requestId: number; startedAt: number; tools: string[] };

export type ToolVerdict = { decision: "allow" | "deny"; reason: string };

const READS_ONLY: ToolVerdict = { decision: "allow", reason: "A connector tool that only reads" };
const CHANGES_SOMETHING: ToolVerdict = {
  decision: "deny",
  reason:
    "The Slack Board runs only connector tools that read. Put this call in your proposal as a step; the user approves it there.",
};

export const toolVerdict = (tool: string, isReadOnly: boolean): ToolVerdict =>
  isReadOnly && connectorToolParts(tool) !== null ? READS_ONLY : CHANGES_SOMETHING;

export const expiredRuns = (runs: ReadonlyMap<string, ActionRun>, now: number): string[] =>
  [...runs].filter(([, run]) => now - run.startedAt > ACTION_LIMIT_MS).map(([agentId]) => agentId);

const answered = (answer: string, tools: string[], projectKeys: string[]): FinishOutcome => {
  const parsed = parseActionAnswer(answer, projectKeys);
  return {
    ok: true,
    reply: parsed.reply,
    tools,
    ...(parsed.proposal === null ? {} : { proposal: parsed.proposal }),
    ...(parsed.proposalError === null ? {} : { proposalError: parsed.proposalError }),
  };
};

export const actionOutcome = (
  turn: { reason: string; answer: string },
  tools: string[],
  projectKeys: string[],
): FinishOutcome => {
  if (turn.reason !== "answer")
    return { ok: false, error: `Claude stopped before answering (${turn.reason})` };
  try {
    return answered(turn.answer, tools, projectKeys);
  } catch (error) {
    if (error instanceof NoAnswer) return { ok: false, error: error.message };
    throw error;
  }
};
