const TOKEN_PATTERN =
  /<@([UW][A-Z0-9]+)(?:\|([^>]+))?>|<#([CG][A-Z0-9]+)(?:\|([^>]*))?>|<(?:!subteam\^|@)(S[A-Z0-9]+)(?:\|([^>]+))?>|<!(here|channel|everyone)(?:\|[^>]+)?>|<(https?:\/\/[^|>\s]+)\|([^>]+)>|<(https?:\/\/[^|>\s]+)>|https?:\/\/[^\s<>]+/g;
const TRAILING_PUNCTUATION = /[.,;:!?)\]'"]+$/;
const SLACK_ENTITY = /&(amp|lt|gt);/g;
const SLACK_ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">" };
const UNKNOWN_PERSON = "someone";

export const decodeEntities = (text) =>
  text.replace(SLACK_ENTITY, (entity) => SLACK_ENTITIES[entity]);

export function safeHref(url) {
  if (typeof url !== "string" || !URL.canParse(url)) return null;
  const parsed = new URL(url);
  return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
}

function tokenOf(match, nameOf) {
  const [
    whole,
    userId,
    userLabel,
    channelId,
    channelLabel,
    groupId,
    groupLabel,
    special,
    labelledUrl,
    linkLabel,
    bracketedUrl,
  ] = match;
  if (userId !== undefined)
    return {
      token: {
        kind: "mention",
        userId,
        text: `@${decodeEntities(userLabel ?? nameOf(userId) ?? UNKNOWN_PERSON)}`,
      },
      length: whole.length,
    };
  if (channelId !== undefined)
    return {
      token: { kind: "channel", channelId, text: `#${decodeEntities(channelLabel || "channel")}` },
      length: whole.length,
    };
  if (groupId !== undefined)
    return {
      token: { kind: "special", text: decodeEntities(groupLabel ?? "@group") },
      length: whole.length,
    };
  if (special !== undefined)
    return { token: { kind: "special", text: `@${special}` }, length: whole.length };
  const bareUrl =
    labelledUrl === undefined && bracketedUrl === undefined
      ? whole.replace(TRAILING_PUNCTUATION, "")
      : null;
  const url = labelledUrl ?? bracketedUrl ?? bareUrl;
  const href = safeHref(decodeEntities(url));
  if (href === null) return null;
  return {
    token: { kind: "link", href, text: decodeEntities(linkLabel ?? url) },
    length: bareUrl === null ? whole.length : bareUrl.length,
  };
}

export function slackTokens(text, nameOf = () => null) {
  const tokens = [];
  let consumed = 0;
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    if (match.index < consumed) continue;
    const found = tokenOf(match, nameOf);
    if (found === null) continue;
    if (match.index > consumed)
      tokens.push({ kind: "text", text: decodeEntities(text.slice(consumed, match.index)) });
    tokens.push(found.token);
    consumed = match.index + found.length;
  }
  if (consumed < text.length)
    tokens.push({ kind: "text", text: decodeEntities(text.slice(consumed)) });
  return tokens;
}
