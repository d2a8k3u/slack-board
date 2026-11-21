export type ConversationKind = "dm" | "group" | "channel";

export type Person = { id: string; name: string };

export type SlackHit = {
  channelId: string;
  channelLabel: string;
  kind: ConversationKind;
  participants: Person[];
  author: Person;
  isBot: boolean;
  ts: string;
  threadTs: string | null;
  permalink: string;
  text: string;
};

export type SearchPage = { hits: SlackHit[]; cursor: string | null };

export type ReplyTarget = { channelId: string; threadTs: string | null };

export type HistoryMessage = {
  ts: string;
  authorId: string | null;
  authorName: string;
  text: string;
};

export type CardMessage = HistoryMessage & { permalink: string };

export type ConversationMessage = HistoryMessage & { isMine: boolean; startsNew: boolean };

export type ActionTurn = {
  author: "me" | "claude";
  text: string;
  at: string;
  tools: string[];
  isFailed: boolean;
};

export type TicketDetails = {
  title: string;
  status: string;
  statusCategory: "new" | "indeterminate" | "done";
  assignee: string | null;
  priority: string | null;
  type: string | null;
  updated: string | null;
  url: string | null;
};

export type InboxCard = {
  key: string;
  kind: ConversationKind;
  title: string;
  target: ReplyTarget;
  messages: CardMessage[];
};

export type IgnoredConversations = ReadonlyMap<string, string>;

export type Step =
  | { type: "slack_reply"; text: string }
  | { type: "slack_reaction"; emoji: string }
  | { type: "jira_comment"; issueKey: string; body: string }
  | { type: "jira_transition"; issueKey: string; transitionId: string; status: string }
  | { type: "jira_assign"; issueKey: string; assignee: string }
  | { type: "jira_edit"; issueKey: string; fields: JiraEditableFields }
  | { type: "tool_call"; tool: string; input: Record<string, unknown> };

export type JiraEditableFields = { summary?: string; labels?: string[]; priority?: string };

export type Proposal = { summary: string; steps: Step[]; replyToTs?: string | null };

export type ProposalCheck = { ok: true; proposal: Proposal } | { ok: false; reason: string };

export type ActionAnswer = {
  reply: string;
  proposal: Proposal | null;
  proposalError: string | null;
};

export type ToolCall = { tool: string; args: Record<string, unknown> };

export type StepContext = { target: ReplyTarget; reactionTs: string | null; jiraSite: string };

export type CardKind = ConversationKind | "compose";

export type Priority = "decision" | "action" | "info" | "social";

export type CardPriority = { key: string; priority: Priority; reason: string };

export type TicketState = {
  key: string;
  status: "loading" | "ready" | "failed";
  details: TicketDetails | null;
  error: string | null;
  summary: string | null;
  summaryStatus: "none" | "loading" | "ready" | "failed";
  summaryError: string | null;
};

export type RequestKind =
  | "propose"
  | "execute"
  | "summarize"
  | "lookup"
  | "sync"
  | "details"
  | "classify"
  | "act"
  | "history";

export type RankingCard = {
  key: string;
  ts: string;
  title: string;
  kind: CardKind;
  ticketKeys: string[];
  messages: { authorName: string; text: string }[];
};

export type RequestStatus = "pending" | "working";

export type BoardCard = {
  key: string;
  kind: CardKind;
  title: string;
  target: ReplyTarget;
  messages: CardMessage[];
  tickets: TicketState[];
  proposal: Proposal | null;
  pending: { kind: RequestKind; status: RequestStatus } | null;
  error: string | null;
  updatedAt: string;
  priority: Priority | null;
  priorityReason: string | null;
  actions: ActionTurn[];
  conversation: ConversationMessage[];
  historyError: string | null;
};

export type Recipient = { channelId: string; label: string; kind: "person" | "channel" };

export type LookupState = { query: string; results: Recipient[]; error: string | null };

export type SyncState = { lastSyncAt: string | null; lastError: string | null };

export type ClaimedRequest = {
  id: number;
  kind: RequestKind;
  input: unknown;
  card: BoardCard | null;
};

export type FinishOutcome =
  | {
      ok: true;
      proposal?: Proposal;
      summary?: string;
      results?: Recipient[];
      details?: TicketDetails;
      priorities?: CardPriority[];
      reply?: string;
      tools?: string[];
      proposalError?: string;
      history?: HistoryMessage[];
    }
  | { ok: false; error: string; remaining?: Proposal };
