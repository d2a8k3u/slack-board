import type { TicketDetails } from "./types.ts";

type Named = { name?: unknown } | null | undefined;

type JiraIssue = {
  key?: unknown;
  webUrl?: unknown;
  fields?: {
    summary?: unknown;
    issuetype?: Named;
    priority?: Named;
    assignee?: { displayName?: unknown } | null;
    updated?: unknown;
    status?: { name?: unknown; statusCategory?: { key?: unknown } | null } | null;
  };
};

const STATUS_CATEGORIES = new Set(["new", "indeterminate", "done"]);

const parseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const issueIn = (value: unknown): JiraIssue | null => {
  if (typeof value !== "object" || value === null) return null;
  const nodes = (value as { issues?: { nodes?: unknown } }).issues?.nodes;
  const candidate = Array.isArray(nodes) ? nodes[0] : value;
  return typeof candidate === "object" && candidate !== null && "fields" in candidate
    ? (candidate as JiraIssue)
    : null;
};

const textOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

const nameOf = (value: Named): string | null => textOrNull(value?.name);

const isoOrNull = (value: unknown): string | null => {
  const text = textOrNull(value);
  if (text === null) return null;
  const time = new Date(text);
  return Number.isNaN(time.getTime()) ? null : time.toISOString();
};

export const readTicketDetails = (raw: string): TicketDetails => {
  const issue = issueIn(parseJson(raw));
  if (issue === null || issue.fields === undefined)
    throw new Error(`Jira returned no Jira issue: ${raw.slice(0, 200)}`);
  const { fields } = issue;
  const category = textOrNull(fields.status?.statusCategory?.key) ?? "new";
  return {
    title: textOrNull(fields.summary) ?? String(issue.key ?? ""),
    status: nameOf(fields.status) ?? "Unknown",
    statusCategory: STATUS_CATEGORIES.has(category)
      ? (category as TicketDetails["statusCategory"])
      : "new",
    assignee: textOrNull(fields.assignee?.displayName),
    priority: nameOf(fields.priority),
    type: nameOf(fields.issuetype),
    updated: isoOrNull(fields.updated),
    url: textOrNull(issue.webUrl),
  };
};
