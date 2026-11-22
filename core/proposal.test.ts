import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkProposal,
  directProposal,
  MAX_TOOL_INPUT_CHARS,
  parseActionAnswer,
  parseProposal,
  SLACK_TEXT_LIMIT,
} from "./proposal.ts";

const PROJECTS = ["PROJ"];

const rejection = (value: unknown): string => {
  const check = checkProposal(value, PROJECTS);
  assert.equal(check.ok, false);
  return check.ok ? "" : check.reason;
};

test("reads a proposal Claude wrapped in prose and a code fence", () => {
  const text =
    'Here it is:\n```json\n{"summary":"Reply and react","steps":[{"type":"slack_reply","text":"On it."},{"type":"slack_reaction","emoji":":+1:"}]}\n```';

  assert.deepEqual(parseProposal(text, PROJECTS), {
    ok: true,
    proposal: {
      summary: "Reply and react",
      steps: [
        { type: "slack_reply", text: "On it." },
        { type: "slack_reaction", emoji: "+1" },
      ],
    },
  });
});

test("rejects an answer that holds no JSON", () => {
  assert.deepEqual(parseProposal("Sorry, I cannot help.", PROJECTS), {
    ok: false,
    reason: "Claude answered without a JSON proposal",
  });
});

test("accepts every allowed Jira step on a configured project", () => {
  const proposal = {
    summary: "Ticket work",
    steps: [
      { type: "jira_comment", issueKey: "PROJ-1", body: "Fixed on dev." },
      { type: "jira_transition", issueKey: "PROJ-1", transitionId: "31", status: "In Review" },
      { type: "jira_assign", issueKey: "PROJ-1", assignee: "Ana Novak" },
      { type: "jira_edit", issueKey: "PROJ-1", fields: { labels: ["backend"], priority: "High" } },
    ],
  };

  assert.deepEqual(checkProposal(proposal, PROJECTS), { ok: true, proposal });
});

test("rejects steps outside the allowed list and their invalid shapes", () => {
  const steps = (step: unknown) => ({ summary: "s", steps: [step] });

  assert.match(
    rejection(steps({ type: "jira_delete", issueKey: "PROJ-1" })),
    /jira_delete is not an allowed step/,
  );
  assert.match(
    rejection(steps({ type: "jira_comment", issueKey: "OTHER-1", body: "x" })),
    /OTHER-1 is not a ticket of PROJ/,
  );
  assert.match(
    rejection(
      steps({ type: "jira_transition", issueKey: "PROJ-1", transitionId: "Done", status: "Done" }),
    ),
    /transitionId/,
  );
  assert.match(
    rejection(steps({ type: "jira_edit", issueKey: "PROJ-1", fields: { reporter: "x" } })),
    /reporter/,
  );
  assert.match(rejection(steps({ type: "jira_edit", issueKey: "PROJ-1", fields: {} })), /fields/);
  assert.match(rejection(steps({ type: "slack_reaction", emoji: "thumbs up" })), /emoji/);
  assert.match(rejection(steps({ type: "slack_reply", text: "  " })), /text/);
  assert.match(rejection({ summary: "s", steps: [] }), /steps/);
  assert.match(rejection(null), /proposal/);
});

test("accepts a call of a claude.ai connector tool with its exact input, and refuses any other tool or input", () => {
  const call = (tool: string, input: unknown) => ({
    summary: "s",
    steps: [{ type: "tool_call", tool, input }],
  });
  const sized = (chars: number) => ({ text: "a".repeat(chars - '{"text":""}'.length) });
  const notion = "mcp__claude_ai_Notion__notion-create-pages";

  assert.deepEqual(checkProposal(call(notion, { title: "Notes" }), PROJECTS), {
    ok: true,
    proposal: call(notion, { title: "Notes" }),
  });
  assert.equal(checkProposal(call(notion, sized(MAX_TOOL_INPUT_CHARS)), PROJECTS).ok, true);
  assert.match(rejection(call(notion, sized(MAX_TOOL_INPUT_CHARS + 1))), /8000/);
  assert.match(
    rejection(call("mcp__plugin_slack-board_board__finish_request", {})),
    /not a connector tool/,
  );
  assert.match(rejection(call("Bash", { command: "ls" })), /not a connector tool/);
  assert.match(rejection(call(notion, ["Notes"])), /input/);
});

test("reads Claude's answer to a prompt with the steps it proposes, keeping the answer when the steps are refused", () => {
  const proposal = {
    summary: "Move PROJ-1 to review",
    steps: [{ type: "jira_transition", issueKey: "PROJ-1", transitionId: "31", status: "Review" }],
  };
  const structured = (value: unknown) => `Done.\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\``;

  assert.deepEqual(
    parseActionAnswer(structured({ reply: "PROJ-1 is ready to move.", proposal }), PROJECTS),
    { reply: "PROJ-1 is ready to move.", proposal, proposalError: null },
  );
  assert.deepEqual(
    parseActionAnswer(structured({ reply: "Nothing to change.", proposal: null }), PROJECTS),
    { reply: "Nothing to change.", proposal: null, proposalError: null },
  );
  assert.deepEqual(
    parseActionAnswer(
      structured({ reply: "Deleting it.", proposal: { summary: "s", steps: [{ type: "x" }] } }),
      PROJECTS,
    ),
    { reply: "Deleting it.", proposal: null, proposalError: "x is not an allowed step" },
  );
  assert.deepEqual(parseActionAnswer(' PROJ-1 shows {"status": "Done"} in Jira. ', PROJECTS), {
    reply: 'PROJ-1 shows {"status": "Done"} in Jira.',
    proposal: null,
    proposalError: null,
  });
  assert.throws(() => parseActionAnswer("  ", PROJECTS), /without an answer/);
});

test("holds a Slack reply to the Slack message limit", () => {
  const reply = (length: number) => ({
    summary: "s",
    steps: [{ type: "slack_reply", text: "a".repeat(length) }],
  });

  assert.equal(checkProposal(reply(SLACK_TEXT_LIMIT), PROJECTS).ok, true);
  assert.match(rejection(reply(SLACK_TEXT_LIMIT + 1)), /5000/);
});

test("keeps the message a thread reply answers, and refuses anything that is not a Slack timestamp", () => {
  const reply = { summary: "s", steps: [{ type: "slack_reply", text: "On it." }] };

  assert.deepEqual(checkProposal({ ...reply, replyToTs: "1795000000.000100" }, PROJECTS), {
    ok: true,
    proposal: { ...reply, replyToTs: "1795000000.000100" },
  });
  assert.match(rejection({ ...reply, replyToTs: "C01/../x" }), /replyToTs/);
});

test("sends the user's own text as written, or reacts when it is only an emoji code", () => {
  assert.deepEqual(directProposal("  Thanks, merging now.  ", null), {
    summary: "Send your message as written",
    steps: [{ type: "slack_reply", text: "Thanks, merging now." }],
    replyToTs: null,
  });
  assert.deepEqual(directProposal(":+1:", "1795000000.000100"), {
    summary: "React with :+1:",
    steps: [{ type: "slack_reaction", emoji: "+1" }],
    replyToTs: "1795000000.000100",
  });
  assert.deepEqual(directProposal(":+1: sounds good", null).steps, [
    { type: "slack_reply", text: ":+1: sounds good" },
  ]);
});

test("holds a proposal to ten steps", () => {
  const proposal = (count: number) => ({
    summary: "s",
    steps: Array.from({ length: count }, () => ({ type: "slack_reaction", emoji: "eyes" })),
  });

  assert.equal(checkProposal(proposal(10), PROJECTS).ok, true);
  assert.match(rejection(proposal(11)), /10 steps/);
});
