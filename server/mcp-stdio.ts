import { createInterface } from "node:readline";

export type McpTool = {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
};

export type McpServer = {
  info: { name: string; version: string };
  tools: McpTool[];
  callTool: (name: string, args: Record<string, unknown>) => { text: string; isError: boolean };
};

type RequestId = string | number | null;

type Incoming = { id?: RequestId; method?: unknown; params?: Record<string, unknown> };

const LATEST_PROTOCOL = "2025-06-18";
const PARSE_ERROR = -32700;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

class RpcError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

const parse = (line: string): Incoming | null => {
  try {
    const value: unknown = JSON.parse(line);
    return typeof value === "object" && value !== null ? (value as Incoming) : null;
  } catch {
    return null;
  }
};

const resultOf = (message: Incoming, server: McpServer): unknown => {
  const params = message.params ?? {};
  switch (message.method) {
    case "initialize":
      return {
        protocolVersion:
          typeof params.protocolVersion === "string" ? params.protocolVersion : LATEST_PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: server.info,
      };
    case "ping":
      return {};
    case "tools/list":
      return { tools: server.tools };
    case "tools/call": {
      if (typeof params.name !== "string")
        throw new RpcError(INVALID_PARAMS, "tools/call needs a tool name");
      const args =
        typeof params.arguments === "object" && params.arguments !== null
          ? (params.arguments as Record<string, unknown>)
          : {};
      const { text, isError } = server.callTool(params.name, args);
      return { content: [{ type: "text", text }], isError };
    }
    default:
      throw new RpcError(METHOD_NOT_FOUND, `Method not found: ${String(message.method)}`);
  }
};

export const answerLine = (line: string, server: McpServer): string | null => {
  if (line.trim() === "") return null;
  const message = parse(line);
  if (message === null)
    return JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: PARSE_ERROR, message: "Parse error" },
    });
  if (message.id === undefined) return null;
  try {
    return JSON.stringify({ jsonrpc: "2.0", id: message.id, result: resultOf(message, server) });
  } catch (error) {
    if (error instanceof RpcError)
      return JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: error.code, message: error.message },
      });
    throw error;
  }
};

export const serveStdio = (server: McpServer): void => {
  createInterface({ input: process.stdin, crlfDelay: Infinity }).on("line", (line) => {
    const answer = answerLine(line, server);
    if (answer !== null) process.stdout.write(`${answer}\n`);
  });
};
