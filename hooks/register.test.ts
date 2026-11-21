import type { CommandRunInput, McpToolResult, On, ProcessRunResult, ToolInfo } from "claude-code";
import { expect, mock, test } from "claude-code/testing";

const BOARD_COMMAND: CommandRunInput = {
  command: "board",
  args: "",
  origin: { kind: "composer" },
  presentation: { isFullscreen: false, columns: 80 },
};
const BOARD_SERVER = "plugin_slack-board_board";
const BOARD_URL = "http://127.0.0.1:4747/#token=test-token";
const BOARD_TOOLS: ToolInfo[] = ["take_request", "board_url"].map((tool) => ({
  name: `mcp__${BOARD_SERVER}__${tool}`,
  description: "",
  mcp: true,
}));
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
  ...BOARD_TOOLS,
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

type Call = { server: string; tool: string; args: Record<string, unknown> };

const startBoard = async (
  $: { session: { start: (e: never) => Promise<unknown> } },
  on: On,
  requests: unknown[],
  connectorAnswer: (call: Call) => McpToolResult = () => textResult("{}"),
) => {
  const clock = mock.clock(on);
  const finished: { id: unknown; outcome: unknown }[] = [];
  const connectorCalls: Call[] = [];
  const registered: Record<string, unknown>[] = [];
  const spawned: { subagent_type?: unknown; prompt?: unknown }[] = [];
  const queue = [...requests];
  on("session.start", (_, e) => ({ cwd: e.cwd }));
  on("command.register", () => ({ value: { command: "board" } }));
  on("session.id", () => ({ value: "session-1" }));
  on("tool.list", () => ({ value: SESSION_TOOLS }));
  on("tool.check", () => ({ decision: "ask" }));
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
      return { value: textResult('"ok"') };
    }
    if (e.tool === "begin_sync")
      return { value: textResult(JSON.stringify({ granted: false, after: 0, startedAt: "" })) };
    return { value: boardServerAnswer(e.server, e.tool) };
  });
  await $.session.start({ cwd: "/", surface: "desktop", isInteractive: true } as never);
  await clock.advance(WORKER_TICK_MS);
  return { finished, connectorCalls, registered, spawned };
};

test("/board opens the board when no Slack connector is connected", async ($, on) => {
  const opened: (readonly string[])[] = [];
  on("tool.list", () => ({ value: BOARD_TOOLS }));
  on("mcp.call", (_, e) => ({ value: boardServerAnswer(e.server, e.tool) }));
  on("process.run", (_, e) => {
    opened.push(e.argv);
    return { value: OPENED };
  });

  const result = await $.command.run(BOARD_COMMAND);

  expect(opened).toEqual([["open", BOARD_URL]]);
  expect(result.text).toBe("The Slack Board is open in your browser.");
});

test("/board says why it cannot open the board", async ($, on) => {
  on("tool.list", () => ({ value: [] }));

  const result = await $.command.run(BOARD_COMMAND);

  expect(result.text).toBe(
    "Slack Board: The slack-board MCP server is not connected in this session",
  );
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
