import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Proposal, SlackHit } from "../core/types.ts";
import { createBoardServer, MAX_LISTED_CHANNELS } from "./http.ts";
import { BoardStore, type SyncInput } from "./store.ts";

type Reply = { status: number; body: string };

const NOTIFY = { newMessages: true, claudeDone: false, sendFailed: true, syncFailed: false };

const send = (
  port: number,
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
): Promise<Reply> =>
  new Promise((resolve, reject) => {
    const payload = options.body === undefined ? undefined : JSON.stringify(options.body);
    const outgoing = request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: options.method ?? "GET",
        headers: {
          host: `127.0.0.1:${port}`,
          ...(payload ? { "content-type": "application/json" } : {}),
          ...options.headers,
        },
      },
      (incoming) => {
        let body = "";
        incoming.on("data", (chunk) => (body += chunk));
        incoming.on("end", () => resolve({ status: incoming.statusCode ?? 0, body }));
      },
    );
    outgoing.on("error", reject);
    outgoing.end(payload);
  });

const withBoard =
  (body: (port: number, token: string, store: BoardStore, webRoot: string) => Promise<void>) =>
  async () => {
    const folder = mkdtempSync(join(tmpdir(), "slack-board-http-"));
    const store = new BoardStore(join(folder, "board.db"));
    const server = createBoardServer({
      store,
      projectKeys: ["PROJ"],
      webRoot: folder,
      polish: true,
      notify: NOTIFY,
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      await body(port, store.token(), store, folder);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      store.close();
      rmSync(folder, { recursive: true, force: true });
    }
  };

test(
  "serves board data only to the board page holding the secret",
  withBoard(async (port, token) => {
    const auth = { "x-board-token": token };

    assert.equal((await send(port, "/api/state")).status, 401);
    assert.equal(
      (await send(port, "/api/state", { headers: { "x-board-token": "guess" } })).status,
      401,
    );
    assert.equal(
      (await send(port, "/api/state", { headers: { ...auth, host: `evil.example:${port}` } }))
        .status,
      403,
    );
    assert.equal(
      (await send(port, "/api/state", { headers: { ...auth, origin: "https://evil.example" } }))
        .status,
      403,
    );
    assert.equal(
      (
        await send(port, "/api/sync", {
          method: "POST",
          headers: { ...auth, origin: "https://evil.example" },
        })
      ).status,
      403,
    );

    const allowed = await send(port, "/api/state", {
      headers: { ...auth, origin: `http://localhost:${port}` },
    });
    assert.equal(allowed.status, 200);
    assert.deepEqual(Object.keys(JSON.parse(allowed.body)), [
      "cards",
      "sync",
      "lookup",
      "news",
      "otherMessages",
      "settings",
    ]);
  }),
);

const sync = (store: BoardStore, input: Partial<SyncInput>) =>
  store.ingest({
    hits: [],
    myHits: [],
    channelHits: [],
    hasMoreChannelHits: false,
    me: "U_ME",
    projectKeys: ["PROJ"],
    syncedAt: new Date("2026-11-21T10:00:00Z"),
    lookbackDays: 7,
    ...input,
  });

const slackHit = (overrides: Partial<SlackHit>): SlackHit => ({
  channelId: "D01",
  channelLabel: "DM",
  kind: "dm",
  participants: [],
  author: { id: "U_ANA", name: "Ana Novak" },
  isBot: false,
  ts: "1795000000.000100",
  threadTs: null,
  permalink: "https://example.slack.com/x",
  text: "hi",
  ...overrides,
});

const channelHit = (channelId: string, ts: string): SlackHit =>
  slackHit({ channelId, channelLabel: `#${channelId}`, kind: "channel", ts });

const seedCard = (store: BoardStore) => sync(store, { hits: [slackHit({})] });

test(
  "serves the vendored search library to the page and nothing else from disk",
  withBoard(async (port, _token, _store, webRoot) => {
    mkdirSync(join(webRoot, "vendor", "typoseek"), { recursive: true });
    writeFileSync(
      join(webRoot, "vendor", "typoseek", "index.mjs"),
      "export const search = () => null\n",
    );
    writeFileSync(join(webRoot, "vendor", "typoseek", "LICENSE"), "MIT\n");
    const library = await send(port, "/vendor/typoseek/index.mjs");

    assert.equal(library.status, 200);
    assert.equal((await send(port, "/vendor/typoseek/missing.mjs")).status, 404);
    assert.equal((await send(port, "/vendor/typoseek/..%2F..%2Fpackage.json")).status, 404);
    assert.equal((await send(port, "/vendor/typoseek/LICENSE")).status, 404);
  }),
);

test(
  "searches the saved people list instantly",
  withBoard(async (port, token, store) => {
    seedCard(store);

    const reply = await send(port, "/api/people?q=nov", { headers: { "x-board-token": token } });

    assert.equal(reply.status, 200);
    assert.deepEqual(JSON.parse(reply.body), {
      people: [{ channelId: "U_ANA", label: "Ana Novak", kind: "person" }],
    });
  }),
);

test(
  "refuses a thread reply to a message that is not on the card",
  withBoard(async (port, token, store) => {
    seedCard(store);
    const auth = { "x-board-token": token };
    const proposal = {
      summary: "Reply",
      steps: [{ type: "slack_reply", text: "On it." }],
      replyToTs: "1795999999.000001",
    };

    assert.equal(
      (
        await send(port, "/api/cards/D01/propose", {
          method: "POST",
          headers: auth,
          body: { text: "ok", replyToTs: "1795999999.000001" },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await send(port, "/api/cards/D01/approve", {
          method: "POST",
          headers: auth,
          body: { proposal },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await send(port, "/api/cards/D01/propose", {
          method: "POST",
          headers: auth,
          body: { text: "ok", replyToTs: "1795000000.000100" },
        })
      ).status,
      202,
    );
    assert.deepEqual(store.claim("worker", new Date())?.input, {
      text: "ok",
      replyToTs: "1795000000.000100",
    });
  }),
);

test(
  "lets me reply in the thread of an earlier message the conversation shows",
  withBoard(async (port, token, store) => {
    seedCard(store);
    store.requestHistory("D01", new Date());
    store.finish(
      store.claim("worker", new Date())?.id ?? 0,
      {
        ok: true,
        history: [
          { ts: "1794999000.000000", authorId: "U_ANA", authorName: "Ana Novak", text: "Earlier" },
        ],
      },
      new Date(),
    );

    const reply = await send(port, "/api/cards/D01/send", {
      method: "POST",
      headers: { "x-board-token": token },
      body: { text: "About that", replyToTs: "1794999000.000000" },
    });

    assert.equal(reply.status, 202);
  }),
);

test(
  "sends my own text as written, without a Claude step, and tells the page its settings and news",
  withBoard(async (port, token, store) => {
    seedCard(store);
    const auth = { "x-board-token": token };

    const state = JSON.parse((await send(port, "/api/state", { headers: auth })).body);
    assert.deepEqual(state.settings, { polish: true, notify: NOTIFY });
    assert.equal(state.news, null);
    assert.equal(
      (
        await send(port, "/api/cards/D01/send", {
          method: "POST",
          headers: auth,
          body: { text: "Merging now.", replyToTs: "1795999999.000001" },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await send(port, "/api/cards/D01/send", {
          method: "POST",
          headers: auth,
          body: { text: "Merging now.", replyToTs: "1795000000.000100" },
        })
      ).status,
      202,
    );
    assert.equal(store.cards()[0]?.proposal, null);

    const request = store.claim("worker", new Date());
    assert.equal(request?.kind, "execute");
    assert.deepEqual(request?.input, {
      proposal: {
        summary: "Send your message as written",
        steps: [{ type: "slack_reply", text: "Merging now." }],
        replyToTs: "1795000000.000100",
      },
    });
  }),
);

test(
  "runs my prompt on a card, shows it in the card's history at once and refuses a second one while it runs",
  withBoard(async (port, token, store) => {
    seedCard(store);
    const auth = { "x-board-token": token };
    const act = (text: string) =>
      send(port, "/api/cards/D01/act", { method: "POST", headers: auth, body: { text } });

    assert.equal((await act("Find the related ticket")).status, 202);
    assert.equal((await act("And another")).status, 409);

    const state = JSON.parse((await send(port, "/api/state", { headers: auth })).body);
    assert.deepEqual(
      state.cards[0].actions.map((turn: { text: string }) => turn.text),
      ["Find the related ticket"],
    );
    assert.equal(store.claim("worker", new Date())?.kind, "act");
  }),
);

test(
  "asks Slack for a card's conversation only when the card has news since the last read",
  withBoard(async (port, token, store) => {
    seedCard(store);
    const history = (key: string) =>
      send(port, `/api/cards/${key}/history`, {
        method: "POST",
        headers: { "x-board-token": token },
      });

    assert.equal((await history("D01")).status, 202);
    assert.equal((await history("D01")).status, 204);
    assert.equal((await history("D99")).status, 404);
  }),
);

test(
  "queues exactly the approved steps, and refuses steps outside the allowed list",
  withBoard(async (port, token, store) => {
    seedCard(store);
    const approve = (proposal: unknown) =>
      send(port, "/api/cards/D01/approve", {
        method: "POST",
        headers: { "x-board-token": token },
        body: { proposal },
      });

    const refused = await approve({
      summary: "Delete",
      steps: [{ type: "jira_delete", issueKey: "PROJ-1" }],
    });
    assert.equal(refused.status, 400);
    assert.match(JSON.parse(refused.body).error, /jira_delete is not an allowed step/);

    const edited = { summary: "Reply", steps: [{ type: "slack_reply", text: "Edited by me." }] };
    assert.equal((await approve(edited)).status, 202);
    assert.deepEqual(store.claim("worker", new Date())?.input, { proposal: edited });
  }),
);

test(
  "approves or discards the steps waiting under an answer in Actions, and refuses steps that no longer wait there",
  withBoard(async (port, token, store) => {
    seedCard(store);
    const comment = {
      summary: "Comment",
      steps: [{ type: "jira_comment", issueKey: "PROJ-1", body: "Fix is on dev." }],
    };
    const answerWithSteps = () => {
      store.act("D01", "Comment on the ticket", new Date());
      store.finish(
        store.claim("worker", new Date())?.id ?? 0,
        { ok: true, reply: "Here is the comment.", tools: [], proposal: comment as Proposal },
        new Date(),
      );
    };
    const onTurn = (turn: number, action: string, proposal?: unknown) =>
      send(port, `/api/cards/D01/turns/${turn}/${action}`, {
        method: "POST",
        headers: { "x-board-token": token },
        body: proposal === undefined ? undefined : { proposal },
      });

    answerWithSteps();
    assert.equal((await onTurn(1, "discard")).status, 204);
    assert.equal(store.cards()[0]?.actionProposal, null);

    answerWithSteps();
    const refused = await onTurn(3, "approve", {
      summary: "Delete",
      steps: [{ type: "jira_delete" }],
    });
    assert.equal(refused.status, 400);
    assert.equal((await onTurn(1, "approve", comment)).status, 404);
    assert.equal((await onTurn(3, "approve", comment)).status, 202);
    assert.equal((await onTurn(3, "approve", comment)).status, 409);
    assert.deepEqual(store.claim("worker", new Date())?.input, { proposal: comment, turn: 3 });
  }),
);

const channelIds = (count: number): string =>
  Array.from({ length: count }, (_, index) => `C${String(index).padStart(3, "0")}`).join(",");

test(
  "sends the other messages of the channels the page opened, and refuses a malformed channel list",
  withBoard(async (port, token, store) => {
    sync(store, { channelHits: [channelHit("C01", "1795000000.000100")] });
    const state = (query: string) =>
      send(port, `/api/state${query}`, { headers: { "x-board-token": token } });

    const opened = JSON.parse((await state("?channels=C01")).body).otherMessages;
    assert.deepEqual(
      opened.channels.map((channel: { channelId: string; messages: unknown[] | null }) => [
        channel.channelId,
        channel.messages?.length ?? null,
      ]),
      [["C01", 1]],
    );
    assert.equal((await state(`?channels=${channelIds(MAX_LISTED_CHANNELS)}`)).status, 200);
    assert.equal((await state(`?channels=${channelIds(MAX_LISTED_CHANNELS + 1)}`)).status, 400);
    assert.equal((await state("?channels=C01,..%2Fx")).status, 400);
  }),
);

test(
  "marks channels read, clears the missing note only when all are marked, and refuses malformed marks",
  withBoard(async (port, token, store) => {
    sync(store, {
      channelHits: [channelHit("C01", "1795000000.000100"), channelHit("C02", "1795000000.000200")],
      hasMoreChannelHits: true,
    });
    const mark = (path: string, body: unknown) =>
      send(port, `/api/channel-messages/${path}`, {
        method: "POST",
        headers: { "x-board-token": token },
        body,
      });
    const summary = () => {
      const { total, isMissing } = store.otherMessages(new Set());
      return { total, isMissing };
    };

    const valid = { channelId: "C01", throughTs: "1795000000.000100" };
    const refused = [
      { channels: "C01" },
      { channels: [{ ...valid, channelId: "../C01" }] },
      { channels: [{ ...valid, throughTs: "soon" }] },
      { channels: Array.from({ length: MAX_LISTED_CHANNELS + 1 }, () => valid) },
    ];
    for (const body of refused) assert.equal((await mark("read", body)).status, 400);
    assert.deepEqual(summary(), { total: 2, isMissing: true });

    assert.equal((await mark("read", { channels: [valid] })).status, 204);
    assert.deepEqual(summary(), { total: 1, isMissing: true });
    const ops = { channelId: "C02", throughTs: "1795000000.000200" };
    assert.equal((await mark("read-all", { channels: [ops] })).status, 204);
    assert.deepEqual(summary(), { total: 0, isMissing: false });
  }),
);
