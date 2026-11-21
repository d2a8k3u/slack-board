const MCP_PREFIX = "mcp__";
const CLAUDE_AI_SERVER =
  /^(claude_ai_[A-Za-z0-9_-]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

const serverOf = (toolName: string, tool: string): string | null => {
  const suffix = `__${tool}`;
  if (!toolName.startsWith(MCP_PREFIX) || !toolName.endsWith(suffix)) return null;
  return toolName.slice(MCP_PREFIX.length, -suffix.length);
};

export const connectorServer = (toolNames: string[], tool: string): string | null =>
  toolNames
    .map((name) => serverOf(name, tool))
    .find((server): server is string => server !== null && CLAUDE_AI_SERVER.test(server)) ?? null;
