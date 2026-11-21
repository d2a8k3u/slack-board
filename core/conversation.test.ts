import assert from "node:assert/strict";
import { test } from "node:test";
import { conversationView } from "./conversation.ts";
import type { CardMessage, HistoryMessage } from "./types.ts";

const ME = "U_ME";

const message = (ts: string, authorId: string, text: string): HistoryMessage => ({
  ts,
  authorId,
  authorName: authorId === ME ? "Me Person" : "Ana Novak",
  text,
});

const waiting = (ts: string, text: string): CardMessage => ({
  ...message(ts, "U_ANA", text),
  permalink: `https://example.slack.com/archives/D01/p${ts.replace(".", "")}`,
});

test("shows the whole conversation once, marks your messages and where the messages waiting for you start", () => {
  const history = [
    message("1795000001.000000", "U_ANA", "Did it ship?"),
    message("1795000002.000000", ME, "Yes."),
    message("1795000003.000000", "U_ANA", "Quick one."),
  ];
  const view = conversationView(
    history,
    [waiting("1795000003.000000", "Quick one."), waiting("1795000004.000000", "Can you check?")],
    ME,
  );

  assert.deepEqual(
    view.map(({ ts, isMine, startsNew }) => ({ ts, isMine, startsNew })),
    [
      { ts: "1795000001.000000", isMine: false, startsNew: false },
      { ts: "1795000002.000000", isMine: true, startsNew: false },
      { ts: "1795000003.000000", isMine: false, startsNew: true },
      { ts: "1795000004.000000", isMine: false, startsNew: false },
    ],
  );
});

test("marks no start of new messages while the conversation holds none of yours", () => {
  const view = conversationView([], [waiting("1795000003.000000", "Quick one.")], ME);

  assert.deepEqual(
    view.map(({ isMine, startsNew }) => ({ isMine, startsNew })),
    [{ isMine: false, startsNew: false }],
  );
});
