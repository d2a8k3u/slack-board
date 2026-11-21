import type { CommandRunInput, McpToolResult, ProcessRunResult, ToolInfo } from "claude-code";
import { expect, test } from "claude-code/testing";

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

const boardServerAnswer = (server: string, tool: string): McpToolResult =>
  server === BOARD_SERVER && tool === "board_url"
    ? { content: [{ type: "text", text: BOARD_URL }], isError: false }
    : { content: [{ type: "text", text: `unknown tool ${server}/${tool}` }], isError: true };

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
