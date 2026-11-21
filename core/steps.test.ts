import assert from "node:assert/strict";
import { test } from "node:test";
import { callFor } from "./steps.ts";
import type { Step, StepContext, ToolCall } from "./types.ts";

const THREAD: StepContext = {
  target: { channelId: "C01", threadTs: "1795000000.500000" },
  reactionTs: "1795000003.000000",
  jiraSite: "example.atlassian.net",
};
const DM: StepContext = {
  target: { channelId: "D01", threadTs: null },
  reactionTs: "1795000000.000100",
  jiraSite: "example.atlassian.net",
};
const ISSUE = { cloudId: "example.atlassian.net", issueIdOrKey: "PROJ-1" };

test("turns each approved step into the connector call that does it, in the right place", () => {
  const rows: { context: StepContext; step: Step; call: ToolCall }[] = [
    {
      context: THREAD,
      step: { type: "slack_reply", text: "Done." },
      call: {
        tool: "slack_send_message",
        args: { channel_id: "C01", message: "Done.", thread_ts: "1795000000.500000" },
      },
    },
    {
      context: DM,
      step: { type: "slack_reply", text: "Done." },
      call: { tool: "slack_send_message", args: { channel_id: "D01", message: "Done." } },
    },
    {
      context: THREAD,
      step: { type: "slack_reaction", emoji: "eyes" },
      call: {
        tool: "slack_add_reaction",
        args: { channel_id: "C01", message_ts: "1795000003.000000", emoji: "eyes" },
      },
    },
    {
      context: DM,
      step: { type: "jira_comment", issueKey: "PROJ-1", body: "Fixed." },
      call: { tool: "addOrEditJiraIssueComment", args: { ...ISSUE, commentBody: "Fixed." } },
    },
    {
      context: DM,
      step: {
        type: "jira_transition",
        issueKey: "PROJ-1",
        transitionId: "31",
        status: "In Review",
      },
      call: { tool: "transitionJiraIssue", args: { ...ISSUE, transitionId: "31" } },
    },
    {
      context: DM,
      step: { type: "jira_assign", issueKey: "PROJ-1", assignee: "Ana Novak" },
      call: { tool: "editJiraIssue", args: { ...ISSUE, fields: { assignee: "Ana Novak" } } },
    },
    {
      context: DM,
      step: { type: "jira_edit", issueKey: "PROJ-1", fields: { labels: ["backend"] } },
      call: { tool: "editJiraIssue", args: { ...ISSUE, fields: { labels: ["backend"] } } },
    },
  ];

  for (const row of rows) assert.deepEqual(callFor(row.step, row.context), row.call, row.step.type);
});

test("refuses a reaction where there is no message to react to", () => {
  assert.throws(
    () => callFor({ type: "slack_reaction", emoji: "eyes" }, { ...DM, reactionTs: null }),
    /no message to react to/,
  );
});
