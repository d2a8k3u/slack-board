import type { EngineInterface, Register } from "claude-code";
import { connectorServer } from "../core/connectors.ts";
import { threadTargetFor } from "../core/inbox.ts";
import { readTicketDetails } from "../core/jira.ts";
import { parsePriorities } from "../core/priority.ts";
import {
  type PromptPair,
  priorityPrompt,
  proposalPrompt,
  styleInstructions,
  type TicketContext,
  ticketSummaryPrompt,
} from "../core/prompts.ts";
import { parseProposal } from "../core/proposal.ts";
import { nextSyncAt } from "../core/schedule.ts";
import { readRecipients, readSearchPage } from "../core/slack-search.ts";
import { callFor } from "../core/steps.ts";
import type {
  BoardCard,
  ClaimedRequest,
  FinishOutcome,
  Proposal,
  RankingCard,
  SlackHit,
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
const BOARD_SERVER_PREFIX = "plugin_slack-board_";
const JIRA_TOOL = "getJiraIssue";
const CURRENT_USER = /user_id is (U[A-Z0-9]+)/;
const DEFAULT_TONE_FILE = "~/.claude/skills/tone-of-voice/SKILL.md";

let cachedServers: Servers | null = null;
let isWorking = false;
let isSyncing = false;
let syncDueAt = Date.now() + FIRST_SYNC_DELAY_MS;

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

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

const boardServerIn = (toolNames: string[]): string => {
  const board = toolNames.find(
    (name) => name.startsWith(`mcp__${BOARD_SERVER_PREFIX}`) && name.endsWith(`__${BOARD_TOOL}`),
  );
  if (board === undefined)
    throw new Error("The slack-board MCP server is not connected in this session");
  return board.slice("mcp__".length, -`__${BOARD_TOOL}`.length);
};

const resolveServers = async ($: EngineInterface): Promise<Servers> => {
  if (cachedServers !== null) return cachedServers;
  const tools = await $.tool.list();
  const names = tools.map((tool) => tool.name);
  const board = boardServerIn(names);
  const slack = connectorServer(names, SEARCH_TOOL);
  if (slack === null)
    throw new Error(
      "Connect Slack on claude.ai (Settings, Connectors); the board uses only claude.ai connectors",
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

const searchAll = async (
  $: EngineInterface,
  servers: Servers,
  query: Record<string, unknown>,
  after: number,
): Promise<SlackHit[]> => {
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
    if (cursor === null || result.hits.length === 0) break;
  }
  return hits;
};

const forMeQueries = (me: string): Record<string, unknown>[] => [
  { filters: `to:<@${me}>`, channel_types: "im,mpim" },
  { keywords: [`<@${me}>`], channel_types: "public_channel,private_channel,mpim" },
  { filters: `with:<@${me}> is:thread` },
];

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
      hits.push(...(await searchAll($, servers, query, window.after)));
    const myHits = await searchAll($, servers, { filters: `from:<@${servers.me}>` }, window.after);
    await callBoard($, servers, "ingest", {
      hits,
      myHits,
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
  return check.ok
    ? { ok: true, proposal: { ...check.proposal, replyToTs } }
    : { ok: false, error: check.reason };
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
      await callText(
        $,
        step.type.startsWith("slack_") ? servers.slack : jiraServer(servers, settings),
        call.tool,
        call.args,
      );
    } catch (error) {
      const done = index === 0 ? "nothing was sent" : `steps 1 to ${index} are done`;
      return {
        ok: false,
        error: `Step ${index + 1} of ${proposal.steps.length} failed, ${done}: ${messageOf(error)}`,
        remaining: { summary: proposal.summary, steps: proposal.steps.slice(index) },
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

const handle = async (
  $: EngineInterface,
  servers: Servers,
  settings: Settings,
  worker: string,
  request: ClaimedRequest,
): Promise<FinishOutcome> => {
  switch (request.kind) {
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
    await callBoard($, servers, "finish_request", { id: request.id, outcome });
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
    });
    return next(e);
  });

  on("command.run", { command: "board" }, async ($) => {
    const board = boardServerIn((await $.tool.list()).map((tool) => tool.name));
    await $.process.run(["open", await callText($, board, "board_url", {})]);
    return { text: "The Slack Board is open in your browser." };
  }).catch((_$, _e, next) => ({
    text: `Slack Board: ${next.error.message ?? "/board did not finish in time"}`,
  }));
};
