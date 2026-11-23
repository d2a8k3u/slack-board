import { connectorToolParts } from "./connectors.ts";
import { isTicketOf } from "./tickets.ts";
import type { ActionAnswer, JiraEditableFields, Proposal, ProposalCheck, Step } from "./types.ts";

export const SLACK_TEXT_LIMIT = 5000;
export const MAX_STEPS = 10;
export const MAX_TOOL_INPUT_CHARS = 8000;

const EMOJI_NAME = /^[a-z0-9_+'-]+$/;
const TRANSITION_ID = /^\d+$/;
const SLACK_TS = /^\d+\.\d+$/;
const EDITABLE_FIELDS = new Set(["summary", "labels", "priority"]);

class ProposalRejected extends Error {}

type Fields = Record<string, unknown>;

const reject = (reason: string): never => {
  throw new ProposalRejected(reason);
};

const isRecord = (value: unknown): value is Fields =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (step: Fields, name: string): string => {
  const value = step[name];
  if (typeof value !== "string" || value.trim() === "")
    return reject(`${String(step.type)} needs a non-empty ${name}`);
  return value;
};

const slackText = (step: Fields): string => {
  const value = text(step, "text");
  if (value.length > SLACK_TEXT_LIMIT)
    reject(`A Slack reply holds at most ${SLACK_TEXT_LIMIT} characters`);
  return value;
};

const issueKey = (step: Fields, projectKeys: string[]): string => {
  const key = text(step, "issueKey");
  if (!isTicketOf(key, projectKeys)) reject(`${key} is not a ticket of ${projectKeys.join(", ")}`);
  return key;
};

const emoji = (step: Fields): string => {
  const name = text(step, "emoji").replace(/^:|:$/g, "");
  if (!EMOJI_NAME.test(name)) reject(`${name} is not a Slack emoji name`);
  return name;
};

const transitionId = (step: Fields): string => {
  const id = text(step, "transitionId");
  if (!TRANSITION_ID.test(id)) reject(`transitionId ${id} is not a Jira transition id`);
  return id;
};

const editableFields = (step: Fields): JiraEditableFields => {
  const fields = step.fields;
  if (!isRecord(fields) || Object.keys(fields).length === 0)
    return reject("jira_edit needs fields to change");
  const unknown = Object.keys(fields).filter((name) => !EDITABLE_FIELDS.has(name));
  if (unknown.length > 0) reject(`jira_edit cannot change ${unknown.join(", ")}`);
  const { summary, labels, priority } = fields;
  if (summary !== undefined && typeof summary !== "string")
    reject("jira_edit summary must be text");
  if (priority !== undefined && typeof priority !== "string")
    reject("jira_edit priority must be text");
  if (
    labels !== undefined &&
    !(Array.isArray(labels) && labels.every((label) => typeof label === "string"))
  )
    reject("jira_edit labels must be a list of text");
  return fields as JiraEditableFields;
};

const connectorTool = (step: Fields): string => {
  const tool = text(step, "tool");
  if (connectorToolParts(tool) === null) reject(`${tool} is not a connector tool`);
  return tool;
};

const toolInput = (step: Fields): Record<string, unknown> => {
  const input = step.input;
  if (!isRecord(input)) return reject("tool_call needs its input as an object");
  if (JSON.stringify(input).length > MAX_TOOL_INPUT_CHARS)
    reject(`A tool call's input holds at most ${MAX_TOOL_INPUT_CHARS} characters`);
  return input;
};

const checkStep = (value: unknown, projectKeys: string[]): Step => {
  if (!isRecord(value)) return reject("Every step must be an object");
  switch (value.type) {
    case "slack_reply":
      return { type: "slack_reply", text: slackText(value) };
    case "slack_reaction":
      return { type: "slack_reaction", emoji: emoji(value) };
    case "jira_comment":
      return {
        type: "jira_comment",
        issueKey: issueKey(value, projectKeys),
        body: text(value, "body"),
      };
    case "jira_transition":
      return {
        type: "jira_transition",
        issueKey: issueKey(value, projectKeys),
        transitionId: transitionId(value),
        status: text(value, "status"),
      };
    case "jira_assign":
      return {
        type: "jira_assign",
        issueKey: issueKey(value, projectKeys),
        assignee: text(value, "assignee"),
      };
    case "jira_edit":
      return {
        type: "jira_edit",
        issueKey: issueKey(value, projectKeys),
        fields: editableFields(value),
      };
    case "tool_call":
      return { type: "tool_call", tool: connectorTool(value), input: toolInput(value) };
    default:
      return reject(`${String(value.type)} is not an allowed step`);
  }
};

const readProposal = (value: unknown, projectKeys: string[]): Proposal => {
  if (!isRecord(value)) return reject("A proposal must be an object with summary and steps");
  const { summary, steps } = value;
  if (typeof summary !== "string") return reject("A proposal needs a summary");
  if (!Array.isArray(steps) || steps.length === 0)
    return reject("A proposal needs at least one of its steps");
  if (steps.length > MAX_STEPS) return reject(`A proposal holds at most ${MAX_STEPS} steps`);
  const checked = { summary, steps: steps.map((step) => checkStep(step, projectKeys)) };
  const { replyToTs } = value;
  if (replyToTs === undefined || replyToTs === null) return checked;
  if (typeof replyToTs !== "string" || !SLACK_TS.test(replyToTs))
    return reject("replyToTs must be a Slack message timestamp");
  return { ...checked, replyToTs };
};

export const checkProposal = (value: unknown, projectKeys: string[]): ProposalCheck => {
  try {
    return { ok: true, proposal: readProposal(value, projectKeys) };
  } catch (error) {
    if (error instanceof ProposalRejected) return { ok: false, reason: error.message };
    throw error;
  }
};

const jsonIn = (answer: string): unknown => {
  const start = answer.indexOf("{");
  const end = answer.lastIndexOf("}");
  if (start === -1 || end < start) return undefined;
  try {
    return JSON.parse(answer.slice(start, end + 1));
  } catch {
    return undefined;
  }
};

const EMOJI_CODE = /^:([a-z0-9_+'-]+):$/;

export const directProposal = (text: string, replyToTs: string | null): Proposal => {
  const trimmed = text.trim();
  const emoji = EMOJI_CODE.exec(trimmed)?.[1];
  if (emoji !== undefined)
    return {
      summary: `React with :${emoji}:`,
      steps: [{ type: "slack_reaction", emoji }],
      replyToTs,
    };
  return {
    summary: "Send your message as written",
    steps: [{ type: "slack_reply", text: trimmed }],
    replyToTs,
  };
};

export const MENTIONS_CHANGED =
  "Claude's draft did not keep exactly the people and channels your note mentions. Draft again, or send your note as written.";

const MENTION_TOKEN = /<([@#!][^|>]*)(?:\|[^>]*)?>/g;

const mentionsIn = (texts: string[]): Set<string> =>
  new Set(texts.flatMap((text) => [...text.matchAll(MENTION_TOKEN)].map(([, key = ""]) => key)));

export const keepsMentions = (note: string, proposal: Proposal): boolean => {
  const kept = mentionsIn(
    proposal.steps.flatMap((step) => (step.type === "slack_reply" ? [step.text] : [])),
  );
  const asked = mentionsIn([note]);
  return kept.size === asked.size && [...asked].every((mention) => kept.has(mention));
};

const isStructuredAnswer = (value: unknown): value is Fields & { reply: string } =>
  isRecord(value) && typeof value.reply === "string";

const answerOf = (answer: string, projectKeys: string[]): ActionAnswer => {
  const value = jsonIn(answer);
  if (!isStructuredAnswer(value))
    return { reply: answer.trim(), proposal: null, proposalError: null };
  const reply = value.reply.trim();
  if (value.proposal === undefined || value.proposal === null)
    return { reply, proposal: null, proposalError: null };
  const check = checkProposal(value.proposal, projectKeys);
  return check.ok
    ? { reply, proposal: check.proposal, proposalError: null }
    : { reply, proposal: null, proposalError: check.reason };
};

export class NoAnswer extends Error {
  constructor() {
    super("Claude finished without an answer");
  }
}

export const parseActionAnswer = (answer: string, projectKeys: string[]): ActionAnswer => {
  const parsed = answerOf(answer, projectKeys);
  if (parsed.reply === "" && parsed.proposal === null) throw new NoAnswer();
  return parsed;
};

export const parseProposal = (answer: string, projectKeys: string[]): ProposalCheck => {
  const value = jsonIn(answer);
  if (value === undefined) return { ok: false, reason: "Claude answered without a JSON proposal" };
  return checkProposal(value, projectKeys);
};
