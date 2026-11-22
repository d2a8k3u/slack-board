export type SlackToken =
  | { kind: "text"; text: string }
  | { kind: "mention"; userId: string; text: string }
  | { kind: "channel"; channelId: string; text: string }
  | { kind: "special"; text: string }
  | { kind: "link"; href: string; text: string };

export function decodeEntities(text: string): string;

export function safeHref(url: unknown): string | null;

export function slackTokens(text: string, nameOf?: (userId: string) => string | null): SlackToken[];
