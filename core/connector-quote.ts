const QUOTE_MARK = /^> ?/;

export const withoutConnectorQuote = (text: string): string => {
  const lines = text.split("\n");
  if (!lines.every((line) => QUOTE_MARK.test(line))) return text;
  return lines.map((line) => line.replace(QUOTE_MARK, "")).join("\n");
};
