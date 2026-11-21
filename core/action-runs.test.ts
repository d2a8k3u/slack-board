import assert from "node:assert/strict";
import { test } from "node:test";
import { ACTION_LIMIT_MS, actionOutcome, expiredRuns, toolVerdict } from "./action-runs.ts";

const PROJECTS = ["PROJ"];

test("lets a running prompt call a connector tool only when the tool says it only reads", () => {
  const verdicts = [
    toolVerdict("mcp__claude_ai_Slack__slack_read_thread", true),
    toolVerdict("mcp__claude_ai_Notion__notion-create-pages", false),
    toolVerdict("mcp__plugin_slack-board_board__finish_request", true),
    toolVerdict("Bash", true),
  ];

  assert.deepEqual(
    verdicts.map((verdict) => verdict.decision),
    ["allow", "deny", "deny", "deny"],
  );
  assert.match(verdicts[1]?.reason ?? "", /proposal/);
});

test("ends a prompt that runs past the time limit, and not a moment before", () => {
  const runs = new Map([
    ["on-time", { requestId: 1, startedAt: 1000, tools: [] }],
    ["late", { requestId: 2, startedAt: 999, tools: [] }],
  ]);

  assert.deepEqual(expiredRuns(runs, 1000 + ACTION_LIMIT_MS), ["late"]);
});

test("turns the agent's last turn into the board's outcome, failing when it stopped or said nothing", () => {
  const proposal = {
    summary: "Comment",
    steps: [{ type: "jira_comment", issueKey: "PROJ-1", body: "Fixed." }],
  };
  const answered = (answer: string) =>
    actionOutcome({ reason: "answer", answer }, ["slack_read_thread"], PROJECTS);

  assert.deepEqual(answered(JSON.stringify({ reply: "PROJ-2 is related.", proposal })), {
    ok: true,
    reply: "PROJ-2 is related.",
    tools: ["slack_read_thread"],
    proposal,
  });
  assert.deepEqual(
    answered(JSON.stringify({ reply: "Deleting it.", proposal: { summary: "s", steps: [] } })),
    {
      ok: true,
      reply: "Deleting it.",
      tools: ["slack_read_thread"],
      proposalError: "A proposal needs at least one of its steps",
    },
  );
  assert.deepEqual(actionOutcome({ reason: "aborted", answer: "" }, [], PROJECTS), {
    ok: false,
    error: "Claude stopped before answering (aborted)",
  });
  assert.deepEqual(answered(" "), { ok: false, error: "Claude finished without an answer" });
});
