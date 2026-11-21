const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const ticketPattern = (projectKeys: string[]): RegExp | null => {
  if (projectKeys.length === 0) return null;
  return new RegExp(
    `(?<![A-Za-z0-9])(${projectKeys.map(escapeRegExp).join("|")})-(\\d+)(?![A-Za-z0-9])`,
    "gi",
  );
};

export const ticketKeys = (text: string, projectKeys: string[]): string[] => {
  const pattern = ticketPattern(projectKeys);
  if (pattern === null) return [];
  const keys = [...text.matchAll(pattern)].map(
    (match) => `${(match[1] ?? "").toUpperCase()}-${match[2] ?? ""}`,
  );
  return [...new Set(keys)];
};

export const isTicketOf = (issueKey: string, projectKeys: string[]): boolean => {
  const keys = ticketKeys(issueKey, projectKeys);
  return keys.length === 1 && keys[0] === issueKey;
};
