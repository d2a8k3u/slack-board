import type { CommandRunInput, McpToolResult, On, ProcessRunResult, ToolInfo } from "claude-code";
import { expect, mock, test } from "claude-code/testing";

const BOARD_COMMAND: CommandRunInput = {
  command: "board",
  args: "",
  origin: { kind: "composer" },
  presentation: { isFullscreen: false, columns: 80 },
};
const BOARD_SERVER_KEY = "board";
const BOARD_SERVER = "plugin:slack-board:board";
const BOARD_URL = "http://127.0.0.1:4747/#token=test-token";
const OPENED: ProcessRunResult = {
  exitCode: 0,
  stdout: "",
  stderr: "",
  isStdoutTruncated: false,
  isStderrTruncated: false,
};

const SLACK = "claude_ai_Slack";
const NOTION = "claude_ai_Notion";
const READ_THREAD = `mcp__${SLACK}__slack_read_thread`;
const CREATE_PAGE = `mcp__${NOTION}__notion-create-pages`;
const ACTION_AGENT = "slack-board:action";
const WORKER_TICK_MS = 2000;
const CONNECTOR_TOOLS: ToolInfo[] = [
  {
    name: `mcp__${SLACK}__slack_search_public_and_private`,
    description: "Searches Slack. The current user_id is U0ME.",
    mcp: true,
  },
  { name: READ_THREAD, description: "", mcp: true },
  { name: CREATE_PAGE, description: "", mcp: true },
];
const SESSION_TOOLS: ToolInfo[] = [
  ...CONNECTOR_TOOLS,
  { name: "Bash", description: "", mcp: false },
];
const STYLE = { options: { style_prompt: "Plain and short." } };

const CARD = {
  key: "D01",
  kind: "dm",
  title: "Ana Novak",
  target: { channelId: "D01", threadTs: null },
  messages: [
    {
      ts: "1795000000.000100",
      authorId: "U_ANA",
      authorName: "Ana Novak",
      text: "Can you check PROJ-1?",
      permalink: "https://example.slack.com/archives/D01/p1795000000000100",
    },
  ],
  tickets: [],
  proposal: null,
  pending: null,
  error: null,
  updatedAt: "2026-11-21T10:00:00.000Z",
  priority: null,
  priorityReason: null,
  actions: [
    {
      author: "me",
      text: "Find the related ticket",
      at: "2026-11-21T10:00:00.000Z",
      tools: [],
      isFailed: false,
    },
  ],
  conversation: [
    {
      ts: "1795000000.000100",
      authorId: "U_ANA",
      authorName: "Ana Novak",
      text: "Can you check PROJ-1?",
      isMine: false,
      startsNew: false,
    },
  ],
  historyError: null,
};

const textResult = (text: string, isError = false): McpToolResult => ({
  content: [{ type: "text", text }],
  isError,
});

const boardServerAnswer = (server: string, tool: string): McpToolResult =>
  server === BOARD_SERVER && tool === "board_url"
    ? textResult(BOARD_URL)
    : textResult(`unknown tool ${server}/${tool}`, true);

const connectsBoard = (on: On): void => {
  on("mcp.connect", (_, e) => ({
    value:
      e.server === BOARD_SERVER_KEY
        ? { isConnected: true, server: BOARD_SERVER }
        : { isConnected: false, reason: "unlisted", message: `${e.server} is not listed` },
  }));
};

type Call = { server: string; tool: string; args: Record<string, unknown> };

const SYNC_WINDOW = { granted: true, after: 1795000000, startedAt: "2026-11-23T10:00:00.000Z" };
const REFUSED_SYNC = { granted: false, after: 0, startedAt: "" };

const startBoard = async (
  $: { session: { start: (e: never) => Promise<unknown> } },
  on: On,
  requests: unknown[],
  connectorAnswer: (call: Call) => McpToolResult = () => textResult("{}"),
  { isSyncGranted = false }: { isSyncGranted?: boolean } = {},
) => {
  const clock = mock.clock(on);
  const ingested: Record<string, unknown>[] = [];
  const finished: { id: unknown; outcome: unknown }[] = [];
  const connectorCalls: Call[] = [];
  const registered: Record<string, unknown>[] = [];
  const spawned: { subagent_type?: unknown; prompt?: unknown }[] = [];
  const statuses: (string | undefined)[] = [];
  const queue = [...requests];
  on("session.start", (_, e) => ({ cwd: e.cwd }));
  on("command.register", () => ({ value: { command: "board" } }));
  on("session.id", () => ({ value: "session-1" }));
  on("tool.list", () => ({ value: SESSION_TOOLS }));
  connectsBoard(on);
  on("tool.check", () => ({ decision: "ask" }));
  on("ui.status", (_, e) => {
    statuses.push(e.text);
    return { value: undefined };
  });
  on("agent.register", (_, e) => {
    registered.push(e as unknown as Record<string, unknown>);
    return { value: { agent: ACTION_AGENT } };
  });
  on("agent.spawn", (_, e) => {
    spawned.push(e as unknown as { subagent_type?: unknown; prompt?: unknown });
    return { model: "sonnet", agentId: "a1" };
  });
  on("mcp.call", (_, e) => {
    if (e.server !== BOARD_SERVER) {
      connectorCalls.push({ server: e.server, tool: e.tool, args: e.args });
      return { value: connectorAnswer(e) };
    }
    if (e.tool === "take_request")
      return { value: textResult(JSON.stringify(queue.shift() ?? null)) };
    if (e.tool === "finish_request") {
      finished.push({ id: e.args.id, outcome: e.args.outcome });
      return { value: textResult("ok") };
    }
    if (e.tool === "begin_sync")
      return { value: textResult(JSON.stringify(isSyncGranted ? SYNC_WINDOW : REFUSED_SYNC)) };
    if (e.tool === "ingest") {
      ingested.push(e.args);
      return { value: textResult(JSON.stringify({ cards: 0, rankingBatches: 0, news: [] })) };
    }
    return { value: boardServerAnswer(e.server, e.tool) };
  });
  await $.session.start({ cwd: "/", surface: "desktop", isInteractive: true } as never);
  await clock.advance(WORKER_TICK_MS);
  return { finished, connectorCalls, registered, spawned, statuses, ingested };
};

test("/board opens the board right after session start, before any tool is listed", async ($, on) => {
  const opened: (readonly string[])[] = [];
  on("tool.list", () => ({ value: [] }));
  connectsBoard(on);
  on("mcp.call", (_, e) => ({ value: boardServerAnswer(e.server, e.tool) }));
  on("process.run", (_, e) => {
    opened.push(e.argv);
    return { value: OPENED };
  });

  const result = await $.command.run(BOARD_COMMAND);

  expect(opened).toEqual([["open", BOARD_URL]]);
  expect(result.text).toBe("The Slack Board is open in your browser.");
});

test("/board says why the board server did not connect", async ($, on) => {
  const failure = "The board server exited before it answered";
  on("mcp.connect", () => ({ value: { isConnected: false, reason: "failed", message: failure } }));

  const result = await $.command.run(BOARD_COMMAND);

  expect(result.text).toBe(`Slack Board: ${failure}`);
});

test(
  "runs a prompt as a hidden agent that gets only the connector tools, and keeps its report out of the chat",
  STYLE,
  async ($, on) => {
    const board = await startBoard($, on, [
      { id: 7, kind: "act", input: { text: "Find the related ticket" }, card: CARD },
    ]);

    expect(board.registered[0]?.tools).toEqual(CONNECTOR_TOOLS.map((tool) => tool.name));
    expect(board.registered[0]?.permissionMode).toBe("dontAsk");
    expect(board.spawned[0]?.subagent_type).toBe(ACTION_AGENT);
    expect(String(board.spawned[0]?.prompt)).toContain(
      "<prompt>\nFind the related ticket\n</prompt>",
    );
    expect(String(board.spawned[0]?.prompt)).toContain("Can you check PROJ-1?");

    const offer = await $.agent.offer({
      agent: ACTION_AGENT,
      description: "",
      source: "plugin",
      provider: { plugin: "slack-board", tier: "user" },
    });
    const report = await $.agent.report({
      agentId: "a1",
      subagentType: ACTION_AGENT,
      provider: { plugin: "slack-board", tier: "user" },
      status: "completed",
      text: "PROJ-2 is related.",
    });
    expect(offer.isOffered).toBe(false);
    expect(report.consumed).toBeDefined();
  },
);

test("runs an approved call of a connector tool with exactly the input that was approved", async ($, on) => {
  const step = { type: "tool_call", tool: CREATE_PAGE, input: { title: "Notes", body: "PROJ-1" } };
  const board = await startBoard($, on, [
    {
      id: 8,
      kind: "execute",
      input: { proposal: { summary: "Write notes", steps: [step] } },
      card: CARD,
    },
  ]);

  expect(board.connectorCalls).toEqual([
    { server: NOTION, tool: "notion-create-pages", args: { title: "Notes", body: "PROJ-1" } },
  ]);
  expect(board.finished).toEqual([{ id: 8, outcome: { ok: true } }]);
});

test("a finished request leaves no error on the status line", async ($, on) => {
  const board = await startBoard($, on, [
    { id: 10, kind: "execute", input: { proposal: { summary: "Nothing", steps: [] } }, card: CARD },
  ]);

  expect(board.finished).toEqual([{ id: 10, outcome: { ok: true } }]);
  expect(board.statuses).toEqual([]);
});

test("reads a thread from Slack and hands its messages to the board", async ($, on) => {
  const thread = JSON.stringify({
    messages: [
      "=== THREAD PARENT MESSAGE ===",
      "From: Ana Novak <ana@example.com> (U_ANA)",
      "Time: 2026-11-21 10:00:00 +07",
      "Message TS: 1795000000.000100",
      "Can you check PROJ-1?",
      "",
      "No thread messsages",
    ].join("\n"),
  });
  const board = await startBoard(
    $,
    on,
    [
      {
        id: 9,
        kind: "history",
        input: {
          key: "C01:1795000000.000100",
          channelId: "C01",
          threadTs: "1795000000.000100",
          latestTs: "1795000000.000100",
        },
        card: null,
      },
    ],
    () => textResult(thread),
  );

  expect(board.connectorCalls.map(({ tool, args }) => ({ tool, args }))).toEqual([
    {
      tool: "slack_read_thread",
      args: {
        channel_id: "C01",
        message_ts: "1795000000.000100",
        limit: 200,
        response_format: "detailed",
      },
    },
  ]);
  expect(board.finished).toEqual([
    {
      id: 9,
      outcome: {
        ok: true,
        history: [
          {
            ts: "1795000000.000100",
            authorId: "U_ANA",
            authorName: "Ana Novak",
            text: "Can you check PROJ-1?",
          },
        ],
      },
    },
  ]);
});

const SEARCH_TOOL = "slack_search_public_and_private";
const OTHERS_IN_MY_CHANNELS = "-from:<@U0ME>";
const MAX_SEARCH_PAGES = 5;

const searchPage = (blocks: string[], cursor: string | null): McpToolResult =>
  textResult(
    JSON.stringify({
      results: blocks.join(""),
      pagination_info:
        cursor === null
          ? "End of results"
          : `For the next page of results use cursor \`${cursor}\``,
    }),
  );

const channelResult = (page: number): string =>
  [
    "### Result 1 of 1",
    "Channel: #backend (ID: C01)",
    "From: Bob Kral (ID: U_BOB)",
    `Message_ts: 1795000000.00000${page}`,
    `Permalink: [link](https://example.slack.com/archives/C01/p179500000000000${page})`,
    "Text: ",
    `news ${page}`,
    "",
    "---",
    "",
  ].join("\n");

const syncChannelPages = ($: Parameters<typeof startBoard>[0], on: On, lastPage: number) =>
  startBoard(
    $,
    on,
    [{ id: 11, kind: "sync", input: {}, card: null }],
    ({ tool, args }) => {
      if (tool !== SEARCH_TOOL || args.filters !== OTHERS_IN_MY_CHANNELS)
        return searchPage([], null);
      const page = args.cursor === undefined ? 1 : Number(String(args.cursor).slice(1));
      return searchPage([channelResult(page)], page === lastPage ? null : `p${page + 1}`);
    },
    { isSyncGranted: true },
  );

test("searches my channels for what people and bots posted, and hands it to the board with the lookback", async ($, on) => {
  const board = await syncChannelPages($, on, MAX_SEARCH_PAGES + 1);

  const searches = board.connectorCalls.filter(
    ({ args }) => args.filters === OTHERS_IN_MY_CHANNELS,
  );
  expect(searches[0]?.args).toEqual({
    filters: OTHERS_IN_MY_CHANNELS,
    channel_types: "public_channel,private_channel",
    only_my_channels: true,
    include_bots: true,
    after: "1795000000",
    sort: "timestamp",
    response_format: "detailed",
    include_context: false,
    limit: 20,
    natural_language_query: "",
  });
  const [sync] = board.ingested;
  expect({
    texts: (sync?.channelHits as { text: string }[] | undefined)?.map((hit) => hit.text),
    hasMore: sync?.hasMoreChannelHits,
    lookbackDays: sync?.lookbackDays,
  }).toEqual({
    texts: ["news 1", "news 2", "news 3", "news 4", "news 5"],
    hasMore: true,
    lookbackDays: 7,
  });
});

test("tells the board nothing is missing when the last page it reads is Slack's last", async ($, on) => {
  const board = await syncChannelPages($, on, MAX_SEARCH_PAGES);

  expect(board.ingested[0]?.hasMoreChannelHits).toBe(false);
});
