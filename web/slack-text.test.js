import assert from "node:assert/strict";
import { test } from "node:test";
import { slackTokens } from "./slack-text.js";

const names = new Map([["U0BOB", "Bob Kral"]]);
const nameOf = (id) => names.get(id) ?? null;

test("shows people, channels and group mentions by name, keeping the id a click needs", () => {
  assert.deepEqual(
    slackTokens(
      "<@U0ANA|Ana Novak> and <@U0BOB>, see <#C0DEV|dev> &amp; <!here> or <!subteam^S01|@backend>",
      nameOf,
    ),
    [
      { kind: "mention", userId: "U0ANA", text: "@Ana Novak" },
      { kind: "text", text: " and " },
      { kind: "mention", userId: "U0BOB", text: "@Bob Kral" },
      { kind: "text", text: ", see " },
      { kind: "channel", channelId: "C0DEV", text: "#dev" },
      { kind: "text", text: " & " },
      { kind: "special", text: "@here" },
      { kind: "text", text: " or " },
      { kind: "special", text: "@backend" },
    ],
  );
});

test("names an unknown person without exposing a raw id", () => {
  assert.deepEqual(slackTokens("<@U0ZED>", nameOf), [
    { kind: "mention", userId: "U0ZED", text: "@someone" },
  ]);
});

test("keeps safe links and leaves other markup as text", () => {
  assert.deepEqual(
    slackTokens(
      "Docs <https://example.com/a|here>, raw https://example.com/b. Bad <javascript:alert(1)|x>",
      nameOf,
    ),
    [
      { kind: "text", text: "Docs " },
      { kind: "link", href: "https://example.com/a", text: "here" },
      { kind: "text", text: ", raw " },
      { kind: "link", href: "https://example.com/b", text: "https://example.com/b" },
      { kind: "text", text: ". Bad <javascript:alert(1)|x>" },
    ],
  );
});
