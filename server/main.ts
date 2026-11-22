import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createBoardServer } from "./http.ts";
import { serveStdio } from "./mcp-stdio.ts";
import { BoardStore } from "./store.ts";
import { runTool, TOOLS } from "./tools.ts";

const DEFAULT_PORT = 4747;
const DEFAULT_PROJECT_KEYS = "";
const BIND_RETRY_MS = 5000;
const HOST = "127.0.0.1";

const requiredEnv = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === "")
    throw new Error(`slack-board: ${name} is not set; run the server through Claude Code`);
  return value;
};

const setting = (name: string): string | undefined => {
  const value = process.env[name];
  return value === undefined || value === "" || value.includes("${") ? undefined : value;
};

const portFrom = (value: string | undefined): number => {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_PORT;
};

const port = portFrom(setting("BOARD_PORT"));
const projectKeys = (setting("BOARD_JIRA_PROJECTS") ?? DEFAULT_PROJECT_KEYS)
  .split(",")
  .map((key) => key.trim().toUpperCase())
  .filter((key) => key !== "");
const store = new BoardStore(join(requiredEnv("CLAUDE_PLUGIN_DATA"), "board.db"));
const webRoot = fileURLToPath(new URL("../web/", import.meta.url));
const boardUrl = () => `http://${HOST}:${port}/#token=${store.token()}`;

const polish = setting("BOARD_POLISH") !== "false";
const http = createBoardServer({ store, projectKeys, webRoot, polish });
const listen = (): void => {
  http.listen(port, HOST);
};
http.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code !== "EADDRINUSE") throw error;
  setTimeout(listen, BIND_RETRY_MS).unref();
});
listen();

serveStdio({
  info: { name: "slack-board", version: "0.2.2" },
  tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
  callTool: (name, args) => runTool(name, args, { store, projectKeys, boardUrl }),
});
