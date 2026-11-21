import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { checkProposal, directProposal, SLACK_TEXT_LIMIT } from "../core/proposal.ts";
import type { BoardStore } from "./store.ts";

export type BoardServerOptions = {
  store: BoardStore;
  projectKeys: string[];
  webRoot: string;
  polish: boolean;
};

const MAX_BODY_BYTES = 64 * 1024;
const MAX_INPUT_CHARS = 4000;
const MAX_QUERY_CHARS = 100;
const LOCAL_HOSTNAMES = ["127.0.0.1", "localhost"];
const SLACK_CHANNEL_ID = /^[CDGU][A-Z0-9]{2,}$/;
const STATIC_FILES: Record<string, { file: string; type: string }> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
  "/app.css": { file: "app.css", type: "text/css; charset=utf-8" },
  "/slack-text.js": { file: "slack-text.js", type: "text/javascript; charset=utf-8" },
  "/board-view.js": { file: "board-view.js", type: "text/javascript; charset=utf-8" },
};

class HttpRefusal extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Route = {
  method: string;
  pattern: RegExp;
  handle: (
    params: string[],
    body: () => Promise<unknown>,
    url: URL,
  ) => Promise<{ status: number; body?: unknown }>;
};

const refuse = (status: number, message: string): never => {
  throw new HttpRefusal(status, message);
};

const record = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return refuse(400, "Send a JSON object");
  return value as Record<string, unknown>;
};

const boundedText = (value: unknown, name: string, maxChars: number): string => {
  if (typeof value !== "string" || value.trim() === "")
    return refuse(400, `${name} must be non-empty text`);
  if (value.length > maxChars) return refuse(400, `${name} holds at most ${maxChars} characters`);
  return value.trim();
};

const readBody = async (incoming: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of incoming) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) refuse(413, "Request body is too large");
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return refuse(400, "Request body is not JSON");
  }
};

const isLocalAuthority = (authority: string, port: number): boolean =>
  LOCAL_HOSTNAMES.some((hostname) => authority === `${hostname}:${port}`);

const sameSecret = (given: string, expected: string): boolean => {
  const left = Buffer.from(given);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
};

const guardApi = (incoming: IncomingMessage, port: number, token: string): void => {
  const origin = incoming.headers.origin;
  if (
    origin !== undefined &&
    !LOCAL_HOSTNAMES.some((hostname) => origin === `http://${hostname}:${port}`)
  )
    refuse(403, "Requests from other sites are refused");
  const given = incoming.headers["x-board-token"];
  if (typeof given !== "string" || !sameSecret(given, token))
    refuse(401, "Open the board with the /board command");
};

const routesFor = ({ store, projectKeys, polish }: BoardServerOptions): Route[] => {
  const cardExists = (key: string): void => {
    if (store.card(key) === null) refuse(404, "This card is gone");
  };
  const replyTarget = (key: string, replyToTs: unknown): string | null => {
    if (replyToTs === undefined || replyToTs === null) return null;
    const card = store.card(key);
    if (card === null) return refuse(404, "This card is gone");
    if (
      typeof replyToTs !== "string" ||
      !card.conversation.some((message) => message.ts === replyToTs)
    )
      return refuse(400, "You can only reply in the thread of a message on this card");
    return replyToTs;
  };
  const queued = (accepted: boolean) =>
    accepted ? { status: 202 } : refuse(409, "Claude is still working on this card");
  return [
    {
      method: "GET",
      pattern: /^\/api\/state$/,
      handle: async () => ({
        status: 200,
        body: {
          cards: store.cards(),
          sync: store.syncState(),
          lookup: store.lookupState(),
          settings: { polish },
        },
      }),
    },
    {
      method: "POST",
      pattern: /^\/api\/cards\/([^/]+)\/send$/,
      handle: async ([key = ""], body) => {
        const input = record(await body());
        const text = boundedText(input.text, "text", SLACK_TEXT_LIMIT);
        cardExists(key);
        const check = checkProposal(
          directProposal(text, replyTarget(key, input.replyToTs)),
          projectKeys,
        );
        if (!check.ok) return refuse(400, check.reason);
        return queued(store.approve(key, check.proposal, new Date()));
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/sync$/,
      handle: async () => {
        store.request("sync", null, {}, new Date());
        return { status: 202 };
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/cards\/([^/]+)\/propose$/,
      handle: async ([key = ""], body) => {
        const input = record(await body());
        const text = boundedText(input.text, "text", MAX_INPUT_CHARS);
        cardExists(key);
        const replyToTs = replyTarget(key, input.replyToTs);
        return queued(
          store.request(
            "propose",
            key,
            replyToTs === null ? { text } : { text, replyToTs },
            new Date(),
          ),
        );
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/cards\/([^/]+)\/act$/,
      handle: async ([key = ""], body) => {
        const text = boundedText(record(await body()).text, "text", MAX_INPUT_CHARS);
        cardExists(key);
        return queued(store.act(key, text, new Date()));
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/cards\/([^/]+)\/history$/,
      handle: async ([key = ""]) => {
        cardExists(key);
        return { status: store.requestHistory(key, new Date()) ? 202 : 204 };
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/cards\/([^/]+)\/approve$/,
      handle: async ([key = ""], body) => {
        const check = checkProposal(record(await body()).proposal, projectKeys);
        if (!check.ok) return refuse(400, check.reason);
        cardExists(key);
        replyTarget(key, check.proposal.replyToTs);
        return queued(store.approve(key, check.proposal, new Date()));
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/cards\/([^/]+)\/discard$/,
      handle: async ([key = ""]) => {
        store.discardProposal(key);
        return { status: 204 };
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/cards\/([^/]+)\/ignore$/,
      handle: async ([key = ""]) => {
        store.ignore(key, new Date());
        return { status: 204 };
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/tickets\/([^/]+)\/summarize$/,
      handle: async ([key = ""]) =>
        store.summarize(key, new Date())
          ? { status: 202 }
          : refuse(404, "No such ticket on the board"),
    },
    {
      method: "GET",
      pattern: /^\/api\/people$/,
      handle: async (_params, _body, url) => {
        const query = url.searchParams.get("q") ?? "";
        if (query.length > MAX_QUERY_CHARS)
          return refuse(400, `q holds at most ${MAX_QUERY_CHARS} characters`);
        return { status: 200, body: { people: store.searchPeople(query) } };
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/compose$/,
      handle: async (_params, body) => {
        const { channelId, label } = record(await body());
        if (typeof channelId !== "string" || !SLACK_CHANNEL_ID.test(channelId))
          return refuse(400, "channelId must be a Slack channel or user id");
        return {
          status: 201,
          body: {
            key: store.compose(
              { channelId, label: boundedText(label, "label", MAX_QUERY_CHARS) },
              new Date(),
            ),
          },
        };
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/lookup$/,
      handle: async (_params, body) => {
        const query = boundedText(record(await body()).query, "query", MAX_QUERY_CHARS);
        store.request("lookup", null, { query }, new Date());
        return { status: 202 };
      },
    },
  ];
};

const sendJson = (outgoing: ServerResponse, status: number, body?: unknown): void => {
  outgoing.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  outgoing.end(body === undefined ? undefined : JSON.stringify(body));
};

const VENDOR_MODULE = /^\/vendor\/typoseek\/([A-Za-z0-9_-]+\.mjs)$/;

const assetFor = (path: string): { file: string; type: string } | undefined => {
  const vendored = VENDOR_MODULE.exec(path)?.[1];
  if (vendored !== undefined)
    return { file: join("vendor", "typoseek", vendored), type: "text/javascript; charset=utf-8" };
  return STATIC_FILES[path];
};

const readAsset = async (webRoot: string, file: string): Promise<Buffer | null> => {
  try {
    return await readFile(join(webRoot, file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
};

const serveStatic = async (
  outgoing: ServerResponse,
  webRoot: string,
  path: string,
): Promise<void> => {
  const asset = assetFor(path);
  const content = asset === undefined ? null : await readAsset(webRoot, asset.file);
  if (asset === undefined || content === null)
    return sendJson(outgoing, 404, { error: "Not found" });
  outgoing.writeHead(200, {
    "content-type": asset.type,
    "cache-control": "no-store",
    "content-security-policy":
      "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-ancestors 'none'",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  outgoing.end(content);
};

export const createBoardServer = (options: BoardServerOptions): Server => {
  const routes = routesFor(options);
  const token = options.store.token();
  const server = createServer(async (incoming, outgoing) => {
    const { port } = server.address() as AddressInfo;
    const url = new URL(incoming.url ?? "/", `http://127.0.0.1:${port}`);
    try {
      if (!isLocalAuthority(incoming.headers.host ?? "", port)) refuse(403, "Unknown host");
      if (!url.pathname.startsWith("/api/")) {
        if (incoming.method !== "GET") refuse(405, "Method not allowed");
        return await serveStatic(outgoing, options.webRoot, url.pathname);
      }
      guardApi(incoming, port, token);
      for (const route of routes) {
        const match = route.pattern.exec(url.pathname);
        if (match === null || route.method !== incoming.method) continue;
        const params = match.slice(1).map((part) => decodeURIComponent(part));
        const reply = await route.handle(params, () => readBody(incoming), url);
        return sendJson(outgoing, reply.status, reply.body);
      }
      refuse(404, "Not found");
    } catch (error) {
      if (error instanceof HttpRefusal)
        return sendJson(outgoing, error.status, { error: error.message });
      console.error("slack-board: request failed", error);
      return sendJson(outgoing, 500, {
        error: "The board server failed on this request; details are in the Claude Code MCP log",
      });
    }
  });
  return server;
};
