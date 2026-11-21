import assert from "node:assert/strict";
import { test } from "node:test";
import { answerLine } from "./mcp-stdio.ts";

const TOOLS = [
  {
    name: "list_cards",
    description: "Lists cards",
    inputSchema: { type: "object" as const, properties: {} },
  },
];
const server = {
  info: { name: "slack-board", version: "0.1.0" },
  tools: TOOLS,
  callTool: (name: string, args: Record<string, unknown>) => ({
    text: `${name}:${JSON.stringify(args)}`,
    isError: name === "broken",
  }),
};

const answer = (message: unknown) => {
  const line = answerLine(typeof message === "string" ? message : JSON.stringify(message), server);
  return line === null ? null : JSON.parse(line);
};

test("speaks the MCP handshake and tool calls Claude Code sends over stdio", () => {
  assert.deepEqual(
    answer({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "claude-code" },
      },
    }),
    {
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "slack-board", version: "0.1.0" },
      },
    },
  );
  assert.equal(answer({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
  assert.deepEqual(answer({ jsonrpc: "2.0", id: 2, method: "ping" }), {
    jsonrpc: "2.0",
    id: 2,
    result: {},
  });
  assert.deepEqual(answer({ jsonrpc: "2.0", id: 3, method: "tools/list" }), {
    jsonrpc: "2.0",
    id: 3,
    result: { tools: TOOLS },
  });
  assert.deepEqual(
    answer({
      jsonrpc: "2.0",
      id: "a",
      method: "tools/call",
      params: { name: "list_cards", arguments: { q: 1 } },
    }),
    {
      jsonrpc: "2.0",
      id: "a",
      result: { content: [{ type: "text", text: 'list_cards:{"q":1}' }], isError: false },
    },
  );
  assert.deepEqual(
    answer({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "broken" } }).result,
    { content: [{ type: "text", text: "broken:{}" }], isError: true },
  );
});

test("answers unknown methods and broken lines with JSON-RPC errors instead of crashing", () => {
  assert.deepEqual(answer({ jsonrpc: "2.0", id: 5, method: "resources/list" }), {
    jsonrpc: "2.0",
    id: 5,
    error: { code: -32601, message: "Method not found: resources/list" },
  });
  assert.deepEqual(answer("{not json"), {
    jsonrpc: "2.0",
    id: null,
    error: { code: -32700, message: "Parse error" },
  });
  assert.deepEqual(answer({ jsonrpc: "2.0", id: 6, method: "tools/call", params: {} }), {
    jsonrpc: "2.0",
    id: 6,
    error: { code: -32602, message: "tools/call needs a tool name" },
  });
  assert.equal(answer("   "), null);
});
