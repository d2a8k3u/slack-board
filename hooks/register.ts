import type { EngineInterface, Register } from "claude-code";
import {
  ACTION_LIMIT_MINUTES,
  type ActionRun,
  actionOutcome,
  expiredRuns,
  toolVerdict,
} from "../core/action-runs.ts";
import { connectorServer, connectorToolParts } from "../core/connectors.ts";
import { threadTargetFor } from "../core/inbox.ts";
import { readTicketDetails } from "../core/jira.ts";
import { parsePriorities } from "../core/priority.ts";
import {
  actionAgentPrompt,
  actionTask,
  type PromptPair,
  priorityPrompt,
  proposalPrompt,
  styleInstructions,
  type TicketContext,
  ticketSummaryPrompt,
} from "../core/prompts.ts";
import { keepsMentions, MENTIONS_CHANGED, parseProposal } from "../core/proposal.ts";
import { nextSyncAt } from "../core/schedule.ts";
import { readHistory } from "../core/slack-history.ts";
import { readRecipients, readSearchPage } from "../core/slack-search.ts";
import { callFor } from "../core/steps.ts";
import type {
  BoardCard,
  ClaimedRequest,
  FinishOutcome,
  Proposal,
  RankingCard,
  SlackHit,
  Step,
} from "../core/types.ts";

type Settings = {
  jiraSite: string;
  projectKeys: string[];
  syncMs: number;
  lookbackDays: number;
  toneFile: string;
  stylePrompt: string;
};
type Servers = { board: string; slack: string; jira: string | null; me: string };
type SyncWindow = { granted: boolean; after: number; startedAt: string };

const WORKER_TICK_MS = 2000;
const FIRST_SYNC_DELAY_MS = 5000;
const LEASE_MARGIN_MS = 30_000;
const MINUTE_MS = 60_000;
const MAX_PAGES = 5;
const PAGE_SIZE = 20;
const LOOKUP_SIZE = 8;
const LATEST_COMMENTS = 10;
const DRAFT_MODEL = "sonnet";
const SUMMARY_MODEL = "haiku";
const SEARCH_TOOL = "slack_search_public_and_private";
const BOARD_TOOL = "take_request";
const BOARD_SERVER_KEY = "board";
const JIRA_TOOL = "getJiraIssue";
const CURRENT_USER = /user_id is (U[A-Z0-9]+)/;
const DEFAULT_TONE_FILE = "~/.claude/skills/tone-of-voice/SKILL.md";
const ACTION_AGENT = "action";
const ACTION_MAX_TURNS = 20;
const HISTORY_SIZE = 30;
const THREAD_READ_LIMIT = 200;
const REPORT_CONSUMED = "The Slack Board shows this answer on its card";

let cachedServers: Servers | null = null;
let isWorking = false;
let isSyncing = false;
let syncDueAt = Date.now() + FIRST_SYNC_DELAY_MS;
let actionAgentType: string | null = null;
const runningActions = new Map<string, ActionRun>();

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const reportStatus =
  ($: EngineInterface) =>
  (error: unknown): void =>
    $.ui.status(`Slack Board: ${messageOf(error)}`);

const settingsFrom = (options: Record<string, unknown>): Settings => {
  const numberOr = (value: unknown, fallback: number, min: number) =>
    typeof value === "number" && Number.isFinite(value) && value >= min ? value : fallback;
  const textOr = (value: unknown, fallback: string) =>
    typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
  return {
    jiraSite: textOr(options.jira_site, ""),
    projectKeys: textOr(options.jira_projects, "")
      .split(",")
      .map((key) => key.trim().toUpperCase())
      .filter((key) => key !== ""),
    syncMs: numberOr(options.sync_minutes, 5, 1) * MINUTE_MS,
    lookbackDays: numberOr(options.lookback_days, 7, 1),
    toneFile: textOr(options.tone_of_voice_file, DEFAULT_TONE_FILE),
    stylePrompt: textOr(options.style_prompt, ""),
  };
};

const connectBoard = async ($: EngineInterface): Promise<string> => {
  const board = await $.mcp.connect(BOARD_SERVER_KEY);
  if (!board.isConnected) throw new Error(board.message);
  return board.server;
};

const resolveServers = async ($: EngineInterface): Promise<Servers> => {
  if (cachedServers !== null) return cachedServers;
  const board = await connectBoard($);
  const tools = await $.tool.list();
  const names = tools.map((tool) => tool.name);
  const slack = connectorServer(names, SEARCH_TOOL);
  if (slack === null)
    throw new Error(
      "Connect Slack on claude.ai (Settings, Connectors) or install the slack@claude-plugins-official plugin",
    );
  const me = CURRENT_USER.exec(
    tools.find((tool) => tool.name === `mcp__${slack}__${SEARCH_TOOL}`)?.description ?? "",
  )?.[1];
  if (me === undefined) throw new Error("The Slack connector does not say which user is signed in");
  cachedServers = {
    board,
    slack,
    jira: connectorServer(names, JIRA_TOOL),
    me,
  };
  return cachedServers;
};

const callText = async (
  $: EngineInterface,
  server: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<string> => {
  const result = await $.mcp.call(server, tool, args);
  const text = result.content.map((block) => block.text ?? "").join("\n");
  if (result.isError) throw new Error(`${tool} failed: ${text.slice(0, 500)}`);
  return text;
};

const callBoard = async <T>(
  $: EngineInterface,
  servers: Servers,
  tool: string,
  args: Record<string, unknown>,
): Promise<T> => JSON.parse(await callText($, servers.board, tool, args)) as T;

const jiraServer = (servers: Servers, settings: Settings): string => {
  if (settings.jiraSite === "")
    throw new Error("Set jira_site in the slack-board settings to use Jira");
  if (servers.jira === null)
    throw new Error(
      "Connect Atlassian on claude.ai (Settings, Connectors); the board uses only claude.ai connectors",
    );
  return servers.jira;
};

const complete = async (
  $: EngineInterface,
  model: string,
  { system, prompt }: PromptPair,
): Promise<string> => {
  const answer = await $.model.complete({ model, system, prompt });
  if (!answer.isAnswered) throw new Error(`Claude did not answer (${answer.reason})`);
  return answer.text;
};

type SearchResult = { hits: SlackHit[]; hasMore: boolean };

const searchAll = async (
  $: EngineInterface,
  servers: Servers,
  query: Record<string, unknown>,
  after: number,
): Promise<SearchResult> => {
  const hits: SlackHit[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const args = {
      ...query,
      after: String(after),
      sort: "timestamp",
      response_format: "detailed",
      include_context: false,
      limit: PAGE_SIZE,
      natural_language_query: "",
      ...(cursor === null ? {} : { cursor }),
    };
    const result = readSearchPage(await callText($, servers.slack, SEARCH_TOOL, args));
    hits.push(...result.hits);
    cursor = result.cursor;
    if (cursor === null || result.hits.length === 0) return { hits, hasMore: false };
  }
  return { hits, hasMore: true };
};

const forMeQueries = (me: string): Record<string, unknown>[] => [
  { filters: `to:<@${me}>`, channel_types: "im,mpim" },
  { keywords: [`<@${me}>`], channel_types: "public_channel,private_channel,mpim" },
  { filters: `with:<@${me}> is:thread` },
];

const othersInMyChannelsQuery = (me: string): Record<string, unknown> => ({
  filters: `-from:<@${me}>`,
  channel_types: "public_channel,private_channel",
  only_my_channels: true,
  include_bots: true,
});

const sync = async (
  $: EngineInterface,
  settings: Settings,
  holder: string,
  isForced: boolean,
): Promise<void> => {
  const servers = await resolveServers($);
  const window = await callBoard<SyncWindow>($, servers, "begin_sync", {
    holder,
    ttlMs: Math.max(settings.syncMs - LEASE_MARGIN_MS, LEASE_MARGIN_MS),
    lookbackDays: settings.lookbackDays,
    force: isForced,
  });
  if (!window.granted) return;
  try {
    const hits: SlackHit[] = [];
    for (const query of forMeQueries(servers.me))
      hits.push(...(await searchAll($, servers, query, window.after)).hits);
    const mine = await searchAll($, servers, { filters: `from:<@${servers.me}>` }, window.after);
    const channels = await searchAll($, servers, othersInMyChannelsQuery(servers.me), window.after);
    await callBoard($, servers, "ingest", {
      hits,
      myHits: mine.hits,
      channelHits: channels.hits,
      hasMoreChannelHits: channels.hasMore,
      lookbackDays: settings.lookbackDays,
      me: servers.me,
      syncedAt: window.startedAt,
    });
  } catch (error) {
    await callText($, servers.board, "fail_sync", { error: messageOf(error) });
    throw error;
  }
};

const readToneFile = async ($: EngineInterface, settings: Settings): Promise<string | null> => {
  const path = settings.toneFile.replace(/^~(?=\/)/, (await $.env.get("HOME")) ?? "~");
  const exists = await $.fs.stat(path).then(
    (stat) => stat.kind === "file",
    () => false,
  );
  return exists ? $.fs.read(path) : null;
};

const readToneOfVoice = async ($: EngineInterface, settings: Settings): Promise<string> =>
  styleInstructions({
    stylePrompt: settings.stylePrompt,
    toneFile: settings.stylePrompt.trim() === "" ? await readToneFile($, settings) : null,
  });

const ticketContexts = async (
  $: EngineInterface,
  servers: Servers,
  settings: Settings,
  card: BoardCard,
): Promise<TicketContext[]> => {
  if (card.tickets.length === 0) return [];
  const jira = jiraServer(servers, settings);
  return Promise.all(
    card.tickets.map(async (ticket) => ({
      issueKey: ticket.key,
      summary: ticket.summary ?? (ticket.details === null ? null : JSON.stringify(ticket.details)),
      transitions: await callText($, jira, "executeRead", {
        name: "listJiraIssueTransitions",
        cloudId: settings.jiraSite,
        inputs: { issueIdOrKey: ticket.key },
      }),
    })),
  );
};

const cardOf = (request: ClaimedRequest): BoardCard => {
  if (request.card === null) throw new Error("This card is gone from the board");
  return request.card;
};

const propose = async (
  $: EngineInterface,
  servers: Servers,
  settings: Settings,
  request: ClaimedRequest,
): Promise<FinishOutcome> => {
  const card = cardOf(request);
  const { text, replyToTs = null } = request.input as { text: string; replyToTs?: string | null };
  const prompt = proposalPrompt({
    toneOfVoice: await readToneOfVoice($, settings),
    card,
    tickets: await ticketContexts($, servers, settings, card),
    note: text,
  });
  const check = parseProposal(await complete($, DRAFT_MODEL, prompt), settings.projectKeys);
  if (!check.ok) return { ok: false, error: check.reason };
  if (!keepsMentions(text, check.proposal)) return { ok: false, error: MENTIONS_CHANGED };
  return { ok: true, proposal: { ...check.proposal, replyToTs } };
};

const connectorTools = async ($: EngineInterface): Promise<string[]> =>
  (await $.tool.list())
    .map((tool) => tool.name)
    .filter((name) => connectorToolParts(name) !== null);

const startAction = async (
  $: EngineInterface,
  settings: Settings,
  request: ClaimedRequest,
): Promise<void> => {
  const card = cardOf(request);
  const { text } = request.input as { text: string };
  const { agent } = await $.agent.register({
    name: ACTION_AGENT,
    description: "Works on a prompt the user wrote on a Slack Board card",
    prompt: actionAgentPrompt(await readToneOfVoice($, settings)),
    tools: await connectorTools($),
    model: DRAFT_MODEL,
    maxTurns: ACTION_MAX_TURNS,
    permissionMode: "dontAsk",
    omitClaudeMd: true,
  });
  actionAgentType = agent;
  const started = await $.agent.spawn({
    subagentType: agent,
    description: "Slack Board prompt",
    prompt: actionTask({
      card,
      conversation: card.conversation,
      earlierTurns: card.actions.slice(0, -1),
      waitingSteps: card.actionProposal?.proposal ?? null,
      prompt: text,
    }),
  });
  if (started.agentId === undefined)
    throw new Error(started.deny ?? "Claude Code did not start the agent");
  runningActions.set(started.agentId, {
    requestId: request.id,
    startedAt: await $.clock.now(),
    tools: [],
  });
};

const finishAction = async (
  $: EngineInterface,
  agentId: string,
  outcome: (run: ActionRun) => FinishOutcome,
): Promise<void> => {
  const run = runningActions.get(agentId);
  if (run === undefined) return;
  runningActions.delete(agentId);
  await callText($, (await resolveServers($)).board, "finish_request", {
    id: run.requestId,
    outcome: outcome(run),
  });
};

const expireActions = async ($: EngineInterface): Promise<void> => {
  for (const agentId of expiredRuns(runningActions, await $.clock.now()))
    await finishAction($, agentId, () => ({
      ok: false,
      error: `Claude did not finish within ${ACTION_LIMIT_MINUTES} minutes`,
    }));
};

const noteToolUse = (agentId: string, tool: string): void => {
  const run = runningActions.get(agentId);
  if (run === undefined || run.tools.includes(tool)) return;
  runningActions.set(agentId, { ...run, tools: [...run.tools, tool] });
};

const history = async (
  $: EngineInterface,
  servers: Servers,
  request: ClaimedRequest,
): Promise<FinishOutcome> => {
  const { channelId, threadTs } = request.input as { channelId: string; threadTs: string | null };
  const raw =
    threadTs === null
      ? await callText($, servers.slack, "slack_read_channel", {
          channel_id: channelId,
          limit: HISTORY_SIZE,
          response_format: "detailed",
        })
      : await callText($, servers.slack, "slack_read_thread", {
          channel_id: channelId,
          message_ts: threadTs,
          limit: THREAD_READ_LIMIT,
          response_format: "detailed",
        });
  return { ok: true, history: readHistory(raw).slice(-HISTORY_SIZE) };
};

const stepServer = (step: Step, servers: Servers, settings: Settings): string => {
  if (step.type === "tool_call") {
    const parts = connectorToolParts(step.tool);
    if (parts === null) throw new Error(`${step.tool} is not a connector tool`);
    return parts.server;
  }
  return step.type.startsWith("slack_") ? servers.slack : jiraServer(servers, settings);
};

const execute = async (
  $: EngineInterface,
  servers: Servers,
  settings: Settings,
  request: ClaimedRequest,
): Promise<FinishOutcome> => {
  const card = cardOf(request);
  const { proposal } = request.input as { proposal: Proposal };
  const replyToTs = proposal.replyToTs ?? null;
  const context = {
    target: threadTargetFor(card.target, replyToTs),
    reactionTs: replyToTs ?? card.messages.at(-1)?.ts ?? null,
    jiraSite: settings.jiraSite,
  };
  for (const [index, step] of proposal.steps.entries()) {
    try {
      const call = callFor(step, context);
      await callText($, stepServer(step, servers, settings), call.tool, call.args);
    } catch (error) {
      const done = index === 0 ? "nothing was sent" : `steps 1 to ${index} are done`;
      return {
        ok: false,
        error: `Step ${index + 1} of ${proposal.steps.length} failed, ${done}: ${messageOf(error)}`,
        remaining: { ...proposal, steps: proposal.steps.slice(index) },
      };
    }
  }
  return { ok: true };
};

const details = async (
  $: EngineInterface,
  servers: Servers,
  settings: Settings,
  request: ClaimedRequest,
): Promise<FinishOutcome> => {
  const { issueKey } = request.input as { issueKey: string };
  const issue = await callText($, jiraServer(servers, settings), JIRA_TOOL, {
    cloudId: settings.jiraSite,
    issueIdOrKey: issueKey,
    view: "compact",
  });
  return { ok: true, details: readTicketDetails(issue) };
};

const classify = async ($: EngineInterface, request: ClaimedRequest): Promise<FinishOutcome> => {
  const { cards } = request.input as { cards: RankingCard[] };
  const answer = await complete($, SUMMARY_MODEL, priorityPrompt(cards));
  return {
    ok: true,
    priorities: parsePriorities(
      answer,
      cards.map((card) => card.key),
    ),
  };
};

const summarize = async (
  $: EngineInterface,
  servers: Servers,
  settings: Settings,
  request: ClaimedRequest,
): Promise<FinishOutcome> => {
  const { issueKey } = request.input as { issueKey: string };
  const jira = jiraServer(servers, settings);
  const issue = await callText($, jira, JIRA_TOOL, {
    cloudId: settings.jiraSite,
    issueIdOrKey: issueKey,
    view: "evidence",
  });
  const comments = await callText($, jira, "listJiraIssueComments", {
    cloudId: settings.jiraSite,
    issueIdOrKey: issueKey,
    maxResults: LATEST_COMMENTS,
    orderBy: "-created",
  });
  return {
    ok: true,
    summary: await complete($, SUMMARY_MODEL, ticketSummaryPrompt({ issueKey, issue, comments })),
  };
};

const lookup = async (
  $: EngineInterface,
  servers: Servers,
  request: ClaimedRequest,
): Promise<FinishOutcome> => {
  const { query } = request.input as { query: string };
  const keyword = query.includes(" ") ? `"${query}"` : query;
  const search = {
    keywords: [keyword],
    natural_language_query: query,
    response_format: "concise",
    limit: LOOKUP_SIZE,
  };
  const users = await callText($, servers.slack, "slack_search_users", search);
  const channels = await callText($, servers.slack, "slack_search_channels", {
    ...search,
    channel_types: "public_channel,private_channel",
  });
  return { ok: true, results: readRecipients(users, channels) };
};

const STARTED = "started";

const handle = async (
  $: EngineInterface,
  servers: Servers,
  settings: Settings,
  worker: string,
  request: ClaimedRequest,
): Promise<FinishOutcome | typeof STARTED> => {
  switch (request.kind) {
    case "act":
      return startAction($, settings, request).then(() => STARTED);
    case "history":
      return history($, servers, request);
    case "propose":
      return propose($, servers, settings, request);
    case "execute":
      return execute($, servers, settings, request);
    case "summarize":
      return summarize($, servers, settings, request);
    case "details":
      return details($, servers, settings, request);
    case "classify":
      return classify($, request);
    case "lookup":
      return lookup($, servers, request);
    case "sync":
      return sync($, settings, worker, true).then(() => ({ ok: true }));
  }
};

const work = async ($: EngineInterface, settings: Settings, worker: string): Promise<void> => {
  if (isWorking) return;
  isWorking = true;
  try {
    const servers = await resolveServers($);
    const request = await callBoard<ClaimedRequest | null>($, servers, BOARD_TOOL, { worker });
    if (request === null) return;
    const outcome = await handle($, servers, settings, worker, request).catch(
      (error: unknown): FinishOutcome => ({ ok: false, error: messageOf(error) }),
    );
    if (outcome !== STARTED)
      await callText($, servers.board, "finish_request", { id: request.id, outcome });
  } catch (error) {
    cachedServers = null;
    $.ui.status(`Slack Board: ${messageOf(error)}`);
  } finally {
    isWorking = false;
  }
};

const syncWhenDue = async (
  $: EngineInterface,
  settings: Settings,
  holder: string,
): Promise<void> => {
  if (isSyncing || Date.now() < syncDueAt) return;
  isSyncing = true;
  try {
    await sync($, settings, holder, false);
    syncDueAt = nextSyncAt(Date.now(), "synced", settings.syncMs);
    $.ui.status(undefined);
  } catch (error) {
    cachedServers = null;
    syncDueAt = nextSyncAt(Date.now(), "failed", settings.syncMs);
    $.ui.status(`Slack Board sync failed: ${messageOf(error)}`);
  } finally {
    isSyncing = false;
  }
};

export const register: Register = (on, options) => {
  const settings = settingsFrom(options as Record<string, unknown>);

  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "board",
      description: "Open the Slack Board in your browser",
    });
    const worker = await $.session.id();
    $.clock.every(WORKER_TICK_MS, () => {
      void work($, settings, worker);
      void syncWhenDue($, settings, worker);
      void expireActions($).catch(reportStatus($));
    });
    return next(e);
  });

  on("turn.complete", async ($, e, next) => {
    if (e.agentId !== undefined && runningActions.has(e.agentId))
      await finishAction($, e.agentId, (run) =>
        actionOutcome(e, run.tools, settings.projectKeys),
      ).catch(reportStatus($));
    return next(e);
  });

  on("agent.report", (_$, e, next) =>
    e.subagentType === actionAgentType ? { consumed: REPORT_CONSUMED } : next(e),
  );

  on("agent.offer", (_$, e, next) =>
    e.agent === actionAgentType ? { isOffered: false } : next(e),
  );

  on("tool.check", (_$, e, next) => {
    if (e.agentId === undefined || !runningActions.has(e.agentId)) return next(e);
    const verdict = toolVerdict(e.tool, e.isReadOnly === true);
    const parts = connectorToolParts(e.tool);
    if (verdict.decision === "allow" && parts !== null) noteToolUse(e.agentId, parts.tool);
    return verdict;
  });

  on("command.run", { command: "board" }, async ($) => {
    const board = await connectBoard($);
    await $.process.run(["open", await callText($, board, "board_url", {})]);
    return { text: "The Slack Board is open in your browser." };
  }).catch((_$, _e, next) => ({
    text: `Slack Board: ${next.error.message ?? "/board did not finish in time"}`,
  }));
};
