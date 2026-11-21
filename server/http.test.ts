import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createBoardServer } from "./http.ts";
import { BoardStore } from "./store.ts";

type Reply = { status: number; body: string };

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
      "settings",
    ]);
  }),
);

const seedCard = (store: BoardStore) =>
  store.ingest({
    hits: [
      {
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
      },
    ],
    myHits: [],
    me: "U_ME",
    projectKeys: ["PROJ"],
    syncedAt: new Date(),
  });

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
  "sends my own text as written, without a Claude step, and tells the page whether polishing is on",
  withBoard(async (port, token, store) => {
    seedCard(store);
    const auth = { "x-board-token": token };

    const state = JSON.parse((await send(port, "/api/state", { headers: auth })).body);
    assert.deepEqual(state.settings, { polish: true });
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
    store.ingest({
      hits: [
        {
          channelId: "D01",
          channelLabel: "DM",
          kind: "dm",
          participants: [],
          author: { id: "U_ANA", name: "Ana" },
          isBot: false,
          ts: "1795000000.000100",
          threadTs: null,
          permalink: "https://example.slack.com/x",
          text: "hi",
        },
      ],
      myHits: [],
      me: "U_ME",
      projectKeys: ["PROJ"],
      syncedAt: new Date(),
    });
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
