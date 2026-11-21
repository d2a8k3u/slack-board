import assert from "node:assert/strict";
import { test } from "node:test";
import { connectorServer } from "./connectors.ts";

test("uses only a claude.ai connector for a tool, as the desktop app or the terminal names it", () => {
  const desktop = [
    "mcp__atlassian__getJiraIssue",
    "mcp__0e2a6625-c3fd-4045-a9fa-038d3ab983b4__getJiraIssue",
  ];
  const terminal = [
    "mcp__plugin_slack_slack__slack_send_message",
    "mcp__claude_ai_Slack__slack_send_message",
  ];
  const customOnly = [
    "mcp__atlassian__getJiraIssue",
    "mcp__plugin_slack-board_board__getJiraIssue",
  ];

  assert.equal(connectorServer(desktop, "getJiraIssue"), "0e2a6625-c3fd-4045-a9fa-038d3ab983b4");
  assert.equal(connectorServer(terminal, "slack_send_message"), "claude_ai_Slack");
  assert.equal(connectorServer(customOnly, "getJiraIssue"), null);
});
