import { connectorToolParts } from "./connectors.ts";
import type { Step, StepContext, ToolCall } from "./types.ts";

const issue = (context: StepContext, issueKey: string) => ({
  cloudId: context.jiraSite,
  issueIdOrKey: issueKey,
});

const slackReply = (context: StepContext, message: string): ToolCall => {
  const { channelId, threadTs } = context.target;
  const args =
    threadTs === null
      ? { channel_id: channelId, message }
      : { channel_id: channelId, message, thread_ts: threadTs };
  return { tool: "slack_send_message", args };
};

const slackReaction = (context: StepContext, emoji: string): ToolCall => {
  if (context.reactionTs === null)
    throw new Error("There is no message to react to in this conversation");
  return {
    tool: "slack_add_reaction",
    args: { channel_id: context.target.channelId, message_ts: context.reactionTs, emoji },
  };
};

export const answersConversation = (steps: Step[]): boolean =>
  steps.some((step) => step.type === "slack_reply" || step.type === "slack_reaction");

const connectorCall = (tool: string, input: Record<string, unknown>): ToolCall => {
  const parts = connectorToolParts(tool);
  if (parts === null) throw new Error(`${tool} is not a connector tool`);
  return { tool: parts.tool, args: input };
};

export const callFor = (step: Step, context: StepContext): ToolCall => {
  switch (step.type) {
    case "slack_reply":
      return slackReply(context, step.text);
    case "slack_reaction":
      return slackReaction(context, step.emoji);
    case "jira_comment":
      return {
        tool: "addOrEditJiraIssueComment",
        args: { ...issue(context, step.issueKey), commentBody: step.body },
      };
    case "jira_transition":
      return {
        tool: "transitionJiraIssue",
        args: { ...issue(context, step.issueKey), transitionId: step.transitionId },
      };
    case "jira_assign":
      return {
        tool: "editJiraIssue",
        args: { ...issue(context, step.issueKey), fields: { assignee: step.assignee } },
      };
    case "jira_edit":
      return {
        tool: "editJiraIssue",
        args: { ...issue(context, step.issueKey), fields: step.fields },
      };
    case "tool_call":
      return connectorCall(step.tool, step.input);
  }
};
