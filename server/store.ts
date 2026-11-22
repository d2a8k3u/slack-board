import { randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { conversationView } from "../core/conversation.ts";
import { dropAnswered, mergeHits, peopleFromHits } from "../core/inbox.ts";
import { answersConversation } from "../core/steps.ts";
import { ticketKeys } from "../core/tickets.ts";
import type {
  ActionTurn,
  BoardCard,
  CardKind,
  CardMessage,
  CardPriority,
  ClaimedRequest,
  ConversationKind,
  FinishOutcome,
  HistoryMessage,
  InboxCard,
  LookupState,
  Priority,
  Proposal,
  RankingCard,
  Recipient,
  ReplyTarget,
  RequestKind,
  RequestStatus,
  SlackHit,
  SyncState,
  TicketDetails,
  TicketState,
} from "../core/types.ts";

export const STALE_CLAIM_MS = 120_000;
export const ACT_STALE_MS = 11 * 60_000;
const SYNC_OVERLAP_MS = 10 * 60_000;
const IGNORED_KEEP_MS = 30 * 24 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const BUSY_TIMEOUT_MS = 5000;
const COMPOSE_PREFIX = "compose:";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS cards (
  key TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  thread_ts TEXT,
  messages TEXT NOT NULL,
  ticket_keys TEXT NOT NULL,
  proposal TEXT,
  error TEXT,
  updated_at TEXT NOT NULL,
  priority TEXT,
  priority_reason TEXT,
  priority_ts TEXT
);
CREATE TABLE IF NOT EXISTS ignored (key TEXT PRIMARY KEY, last_ts TEXT NOT NULL, ignored_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS people (channel_id TEXT PRIMARY KEY, label TEXT NOT NULL, kind TEXT NOT NULL, seen_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  card_key TEXT,
  input TEXT NOT NULL,
  status TEXT NOT NULL,
  claimed_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS card_context (
  key TEXT PRIMARY KEY,
  actions TEXT NOT NULL DEFAULT '[]',
  history TEXT,
  history_ts TEXT,
  history_error TEXT
);
`;

const TICKETS_TABLE = `
CREATE TABLE tickets (
  key TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  details TEXT,
  error TEXT,
  summary TEXT,
  summary_status TEXT NOT NULL DEFAULT 'none',
  summary_error TEXT,
  updated_at TEXT NOT NULL
);
`;

const SCHEMA_VERSION = 4;
const MAX_PEOPLE_RESULTS = 20;
const MAX_RANKING_BATCH = 20;
const RANKING_MESSAGES = 5;
const RANKING_TEXT_CHARS = 600;
const PRIORITY_COLUMNS = ["priority", "priority_reason", "priority_ts"];
const BACKGROUND_KINDS = ["details", "classify"];

type CardRow = {
  key: string;
  kind: CardKind;
  title: string;
  channel_id: string;
  thread_ts: string | null;
  messages: string;
  ticket_keys: string;
  proposal: string | null;
  error: string | null;
  updated_at: string;
  priority: Priority | null;
  priority_reason: string | null;
  priority_ts: string | null;
};

type ContextRow = {
  actions: string | null;
  history: string | null;
  history_ts: string | null;
  history_error: string | null;
};

type HistoryInput = { key: string; channelId: string; threadTs: string | null; latestTs: string };

type RequestRow = {
  id: number;
  kind: RequestKind;
  card_key: string | null;
  input: string;
  status: RequestStatus;
};

type TicketRow = {
  key: string;
  status: TicketState["status"];
  details: string | null;
  error: string | null;
  summary: string | null;
  summary_status: TicketState["summaryStatus"];
  summary_error: string | null;
};

type PersonRow = { channel_id: string; label: string; kind: Recipient["kind"] };

const ticketOf = (row: TicketRow): TicketState => ({
  key: row.key,
  status: row.status,
  details: row.details === null ? null : (JSON.parse(row.details) as TicketDetails),
  error: row.error,
  summary: row.summary,
  summaryStatus: row.summary_status,
  summaryError: row.summary_error,
});

const recipientOf = (row: PersonRow): Recipient => ({
  channelId: row.channel_id,
  label: row.label,
  kind: row.kind,
});

const rankingCardOf = (row: CardRow): RankingCard | null => {
  const messages = messagesOf(row);
  const latest = messages.at(-1);
  if (latest === undefined) return null;
  return {
    key: row.key,
    ts: latest.ts,
    title: row.title,
    kind: row.kind,
    ticketKeys: JSON.parse(row.ticket_keys) as string[],
    messages: messages.slice(-RANKING_MESSAGES).map((message) => ({
      authorName: message.authorName,
      text: message.text.slice(0, RANKING_TEXT_CHARS),
    })),
  };
};

const tsToIso = (ts: string): string => new Date(Number(ts) * 1000).toISOString();

const likePattern = (query: string): string =>
  `%${query.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;

type Lease = { holder: string; until: string };

export type SyncInput = {
  hits: SlackHit[];
  myHits: SlackHit[];
  me: string;
  projectKeys: string[];
  syncedAt: Date;
};

const iso = (date: Date): string => date.toISOString();

const runProposalOf = (request: RequestRow): Proposal =>
  (JSON.parse(request.input) as { proposal: Proposal }).proposal;

const lastTs = (messages: CardMessage[]): string | null => messages.at(-1)?.ts ?? null;

type InboxRow = CardRow & { kind: ConversationKind };

const messagesOf = (row: CardRow): CardMessage[] =>
  (JSON.parse(row.messages) as CardMessage[]).map((message) => ({
    ...message,
    authorId: message.authorId ?? null,
  }));

const targetOf = (row: CardRow): ReplyTarget => ({
  channelId: row.channel_id,
  threadTs: row.thread_ts,
});

const inboxCardOf = (row: InboxRow): InboxCard => ({
  key: row.key,
  kind: row.kind,
  title: row.title,
  target: targetOf(row),
  messages: messagesOf(row),
});

export class BoardStore {
  readonly #db: DatabaseSync;

  constructor(path: string) {
    this.#db = new DatabaseSync(path);
    this.#db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}; PRAGMA journal_mode = WAL;`);
    this.#db.exec(SCHEMA);
    this.#migrate();
  }

  #migrate(): void {
    const { user_version: version } = this.#db.prepare("PRAGMA user_version").get() as {
      user_version: number;
    };
    if (version >= SCHEMA_VERSION) return;
    this.#transaction(() => {
      if (version < 2) this.#rebuildTickets();
      this.#addPriorityColumns();
      if (version < 4) this.#db.exec("UPDATE cards SET priority_ts = NULL WHERE priority IS NULL");
      this.#db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    });
  }

  #rebuildTickets(): void {
    this.#db.exec(`DROP TABLE IF EXISTS tickets; ${TICKETS_TABLE}`);
    this.#db.prepare(`DELETE FROM requests WHERE kind = 'summarize'`).run();
    const now = new Date();
    for (const { ticket_keys } of this.#db.prepare("SELECT ticket_keys FROM cards").all() as {
      ticket_keys: string;
    }[]) {
      for (const key of JSON.parse(ticket_keys) as string[]) this.#trackTicket(key, now);
    }
  }

  #addPriorityColumns(): void {
    const existing = new Set(
      (this.#db.prepare("PRAGMA table_info(cards)").all() as { name: string }[]).map(
        (column) => column.name,
      ),
    );
    for (const column of PRIORITY_COLUMNS)
      if (!existing.has(column)) this.#db.exec(`ALTER TABLE cards ADD COLUMN ${column} TEXT`);
  }

  close(): void {
    this.#db.close();
  }

  token(): string {
    return this.#transaction(() => {
      const existing = this.#meta<string>("token");
      if (existing !== null) return existing;
      const token = randomBytes(32).toString("base64url");
      this.#setMeta("token", token);
      return token;
    });
  }

  syncWindowStart(now: Date, lookbackDays: number): Date {
    const lastSyncAt = this.#meta<string>("last_sync_at");
    if (lastSyncAt === null) return new Date(now.getTime() - lookbackDays * DAY_MS);
    return new Date(new Date(lastSyncAt).getTime() - SYNC_OVERLAP_MS);
  }

  syncState(): SyncState {
    return {
      lastSyncAt: this.#meta<string>("last_sync_at"),
      lastError: this.#meta<string>("last_sync_error"),
      isRunning:
        this.#db.prepare("SELECT id FROM requests WHERE kind = 'sync' LIMIT 1").get() !== undefined,
    };
  }

  lookupState(): LookupState | null {
    return this.#meta<LookupState>("lookup");
  }

  acquireSyncLease(holder: string, now: Date, ttlMs: number): boolean {
    return this.#transaction(() => {
      const lease = this.#meta<Lease>("sync_lease");
      const isFree = lease === null || lease.holder === holder || lease.until <= iso(now);
      if (isFree)
        this.#setMeta("sync_lease", { holder, until: iso(new Date(now.getTime() + ttlMs)) });
      return isFree;
    });
  }

  ingest(sync: SyncInput): void {
    this.#transaction(() => {
      this.#db
        .prepare("DELETE FROM ignored WHERE ignored_at < ?")
        .run(iso(new Date(sync.syncedAt.getTime() - IGNORED_KEEP_MS)));
      const rows = this.#db
        .prepare(`SELECT * FROM cards WHERE kind != 'compose'`)
        .all() as InboxRow[];
      const before = new Map(rows.map((row) => [row.key, row]));
      const ignored = new Map(
        (
          this.#db.prepare("SELECT key, last_ts FROM ignored").all() as {
            key: string;
            last_ts: string;
          }[]
        ).map((row) => [row.key, row.last_ts]),
      );
      const merged = dropAnswered(
        mergeHits(rows.map(inboxCardOf), sync.hits, sync.me, ignored),
        sync.myHits,
      );
      for (const card of merged) this.#saveInboxCard(card, before.get(card.key), sync);
      const kept = new Set(merged.map((card) => card.key));
      for (const key of before.keys()) if (!kept.has(key)) this.#deleteCard(key);
      this.#forgetUnusedTickets();
      this.#rememberPeople(peopleFromHits(sync.hits, sync.me), sync.syncedAt);
      this.#setMeta("last_sync_at", iso(sync.syncedAt));
      this.#setMeta("me", sync.me);
      this.#db.prepare(`DELETE FROM meta WHERE key = 'last_sync_error'`).run();
    });
  }

  cards(): BoardCard[] {
    const rows = this.#db
      .prepare(
        `SELECT cards.*, card_context.actions, card_context.history, card_context.history_error
         FROM cards LEFT JOIN card_context ON card_context.key = cards.key ORDER BY updated_at DESC`,
      )
      .all() as (CardRow & Omit<ContextRow, "history_ts">)[];
    const me = this.#meta<string>("me");
    const tickets = new Map(
      (
        this.#db
          .prepare(
            "SELECT key, status, details, error, summary, summary_status, summary_error FROM tickets",
          )
          .all() as TicketRow[]
      ).map((row) => [row.key, ticketOf(row)]),
    );
    const open = new Map(
      (
        this.#db
          .prepare("SELECT card_key, kind, status FROM requests WHERE card_key IS NOT NULL")
          .all() as { card_key: string; kind: RequestKind; status: RequestStatus }[]
      ).map((row) => [row.card_key, { kind: row.kind, status: row.status }]),
    );
    return rows.map((row) => {
      const proposal = row.proposal === null ? null : (JSON.parse(row.proposal) as Proposal);
      return {
        key: row.key,
        kind: row.kind,
        title: row.title,
        target: targetOf(row),
        messages: messagesOf(row),
        actions: row.actions === null ? [] : (JSON.parse(row.actions) as ActionTurn[]),
        conversation: conversationView(
          row.history === null ? [] : (JSON.parse(row.history) as HistoryMessage[]),
          messagesOf(row),
          me,
        ),
        historyError: row.history_error,
        tickets: (JSON.parse(row.ticket_keys) as string[])
          .map((key) => tickets.get(key))
          .filter((ticket) => ticket !== undefined),
        proposal,
        approveCloses: proposal !== null && answersConversation(proposal.steps),
        pending: open.get(row.key) ?? null,
        error: row.error,
        updatedAt: row.updated_at,
        priority: row.priority,
        priorityReason: row.priority_reason,
      };
    });
  }

  act(key: string, text: string, now: Date): boolean {
    return this.#transaction(() => {
      if (!this.#enqueue("act", key, { text }, now)) return false;
      this.#appendTurn(key, { author: "me", text, at: iso(now), tools: [], isFailed: false });
      return true;
    });
  }

  requestHistory(key: string, now: Date): boolean {
    return this.#transaction(() => {
      const row = this.#db.prepare("SELECT * FROM cards WHERE key = ?").get(key) as
        | CardRow
        | undefined;
      const latestTs = row === undefined ? null : lastTs(messagesOf(row));
      if (row === undefined || row.kind === "compose" || latestTs === null) return false;
      const context = this.#db
        .prepare("SELECT history_ts, history_error FROM card_context WHERE key = ?")
        .get(key) as Pick<ContextRow, "history_ts" | "history_error"> | undefined;
      if (context?.history_ts === latestTs && context.history_error === null) return false;
      const input: HistoryInput = {
        key,
        channelId: row.channel_id,
        threadTs: row.thread_ts,
        latestTs,
      };
      return this.#enqueue("history", null, input, now);
    });
  }

  card(key: string): BoardCard | null {
    return this.cards().find((card) => card.key === key) ?? null;
  }

  compose(recipient: Pick<Recipient, "channelId" | "label">, now: Date): string {
    const key = `${COMPOSE_PREFIX}${randomUUID()}`;
    this.#db
      .prepare(
        `INSERT INTO cards (key, kind, title, channel_id, thread_ts, messages, ticket_keys, updated_at) VALUES (?, 'compose', ?, ?, NULL, '[]', '[]', ?)`,
      )
      .run(key, recipient.label, recipient.channelId, iso(now));
    return key;
  }

  ignore(key: string, now: Date): void {
    this.#transaction(() => this.#closeCard(key, now));
  }

  discardProposal(key: string): void {
    this.#db.prepare("UPDATE cards SET proposal = NULL, error = NULL WHERE key = ?").run(key);
  }

  request(kind: RequestKind, cardKey: string | null, input: unknown, now: Date): boolean {
    return this.#transaction(() => this.#enqueue(kind, cardKey, input, now));
  }

  approve(key: string, proposal: Proposal, now: Date): boolean {
    return this.#queueRun(key, proposal, proposal, now);
  }

  send(key: string, proposal: Proposal, now: Date): boolean {
    return this.#queueRun(key, proposal, null, now);
  }

  #queueRun(key: string, proposal: Proposal, shownProposal: Proposal | null, now: Date): boolean {
    return this.#transaction(() => {
      if (!this.#enqueue("execute", key, { proposal }, now)) return false;
      this.#db
        .prepare("UPDATE cards SET proposal = ?, error = NULL WHERE key = ?")
        .run(shownProposal === null ? null : JSON.stringify(shownProposal), key);
      return true;
    });
  }

  summarize(issueKey: string, now: Date): boolean {
    return this.#transaction(() => {
      if (this.#db.prepare("SELECT key FROM tickets WHERE key = ?").get(issueKey) === undefined)
        return false;
      this.#db
        .prepare(
          `UPDATE tickets SET summary_status = 'loading', summary_error = NULL, updated_at = ? WHERE key = ?`,
        )
        .run(iso(now), issueKey);
      this.#enqueue("summarize", null, { issueKey }, now);
      return true;
    });
  }

  requestRanking(now: Date): number {
    return this.#transaction(() => {
      const open = new Set(
        (
          this.#db.prepare(`SELECT input FROM requests WHERE kind = 'classify'`).all() as {
            input: string;
          }[]
        ).flatMap((row) =>
          (JSON.parse(row.input) as { cards: RankingCard[] }).cards.map((card) => card.key),
        ),
      );
      const rows = this.#db
        .prepare(`SELECT * FROM cards WHERE kind != 'compose' ORDER BY updated_at DESC`)
        .all() as CardRow[];
      const waiting = rows
        .map(rankingCardOf)
        .filter((card): card is RankingCard => card !== null && !open.has(card.key));
      const unranked = waiting.filter(
        (card) => rows.find((row) => row.key === card.key)?.priority_ts !== card.ts,
      );
      let batches = 0;
      for (let start = 0; start < unranked.length; start += MAX_RANKING_BATCH) {
        if (
          this.#enqueue(
            "classify",
            null,
            { cards: unranked.slice(start, start + MAX_RANKING_BATCH) },
            now,
          )
        )
          batches += 1;
      }
      return batches;
    });
  }

  searchPeople(query: string): Recipient[] {
    const rows = this.#db
      .prepare(
        `SELECT channel_id, label, kind FROM people WHERE label LIKE ? ESCAPE '\\' ORDER BY kind = 'channel', seen_at DESC, label LIMIT ?`,
      )
      .all(likePattern(query.trim()), MAX_PEOPLE_RESULTS) as PersonRow[];
    return rows.map(recipientOf);
  }

  claim(worker: string, now: Date): ClaimedRequest | null {
    const row = this.#transaction(() => {
      const staleBefore = (ms: number) => iso(new Date(now.getTime() - ms));
      const next = this.#db
        .prepare(
          `SELECT id, kind, card_key, input, status FROM requests
           WHERE status = 'pending' OR (status = 'working' AND updated_at < CASE kind WHEN 'act' THEN ? ELSE ? END)
           ORDER BY kind IN (${BACKGROUND_KINDS.map(() => "?").join(", ")}), id LIMIT 1`,
        )
        .get(staleBefore(ACT_STALE_MS), staleBefore(STALE_CLAIM_MS), ...BACKGROUND_KINDS) as
        | RequestRow
        | undefined;
      if (next === undefined) return null;
      this.#db
        .prepare(
          `UPDATE requests SET status = 'working', claimed_by = ?, updated_at = ? WHERE id = ?`,
        )
        .run(worker, iso(now), next.id);
      return next;
    });
    if (row === null) return null;
    return {
      id: row.id,
      kind: row.kind,
      input: JSON.parse(row.input),
      card: row.card_key === null ? null : this.card(row.card_key),
    };
  }

  finish(id: number, outcome: FinishOutcome, now: Date): void {
    this.#transaction(() => {
      const request = this.#db
        .prepare("SELECT id, kind, card_key, input, status FROM requests WHERE id = ?")
        .get(id) as RequestRow | undefined;
      if (request === undefined) return;
      this.#db.prepare("DELETE FROM requests WHERE id = ?").run(id);
      this.#apply(request, outcome, now);
    });
  }

  failSync(error: string): void {
    this.#setMeta("last_sync_error", error);
  }

  #apply(request: RequestRow, outcome: FinishOutcome, now: Date): void {
    const input = JSON.parse(request.input) as { issueKey?: string; query?: string };
    switch (request.kind) {
      case "propose":
        if (outcome.ok)
          this.#db
            .prepare("UPDATE cards SET proposal = ?, error = NULL WHERE key = ?")
            .run(JSON.stringify(outcome.proposal ?? null), request.card_key);
        else
          this.#db
            .prepare("UPDATE cards SET error = ? WHERE key = ?")
            .run(outcome.error, request.card_key);
        return;
      case "act":
        this.#applyAnswer(request.card_key ?? "", outcome, now);
        return;
      case "history":
        this.#applyHistory(JSON.parse(request.input) as HistoryInput, outcome);
        return;
      case "execute":
        if (outcome.ok) this.#applyRun(request, now);
        else
          this.#db
            .prepare("UPDATE cards SET error = ?, proposal = ? WHERE key = ?")
            .run(
              outcome.error,
              JSON.stringify(outcome.remaining ?? runProposalOf(request)),
              request.card_key,
            );
        return;
      case "details":
        this.#db
          .prepare(
            "UPDATE tickets SET status = ?, details = ?, error = ?, updated_at = ? WHERE key = ?",
          )
          .run(
            outcome.ok ? "ready" : "failed",
            outcome.ok ? JSON.stringify(outcome.details ?? null) : null,
            outcome.ok ? null : outcome.error,
            iso(now),
            input.issueKey ?? "",
          );
        return;
      case "summarize":
        this.#db
          .prepare(
            "UPDATE tickets SET summary_status = ?, summary = ?, summary_error = ?, updated_at = ? WHERE key = ?",
          )
          .run(
            outcome.ok ? "ready" : "failed",
            outcome.ok ? (outcome.summary ?? "") : null,
            outcome.ok ? null : outcome.error,
            iso(now),
            input.issueKey ?? "",
          );
        return;
      case "lookup":
        if (outcome.ok) this.#rememberPeople(outcome.results ?? [], now);
        this.#setMeta("lookup", {
          query: input.query ?? "",
          results: outcome.ok ? (outcome.results ?? []) : [],
          error: outcome.ok ? null : outcome.error,
        });
        return;
      case "sync":
        if (!outcome.ok) this.failSync(outcome.error);
        return;
      case "classify":
        if (outcome.ok)
          this.#applyPriorities(
            (JSON.parse(request.input) as { cards: RankingCard[] }).cards,
            outcome.priorities ?? [],
          );
        return;
    }
  }

  #applyAnswer(key: string, outcome: FinishOutcome, now: Date): void {
    const claude = (text: string, isFailed: boolean, tools: string[] = []): ActionTurn => ({
      author: "claude",
      text,
      at: iso(now),
      tools,
      isFailed,
    });
    if (!outcome.ok) {
      this.#appendTurn(key, claude(outcome.error, true));
      return;
    }
    this.#appendTurn(key, claude(outcome.reply ?? "", false, outcome.tools));
    if (outcome.proposal !== undefined)
      this.#db
        .prepare("UPDATE cards SET proposal = ?, error = NULL WHERE key = ?")
        .run(JSON.stringify(outcome.proposal), key);
    if (outcome.proposalError !== undefined)
      this.#appendTurn(
        key,
        claude(`The board refused the steps Claude proposed: ${outcome.proposalError}`, true),
      );
  }

  #applyHistory(input: HistoryInput, outcome: FinishOutcome): void {
    if (outcome.ok)
      this.#saveContext(input.key, {
        history: JSON.stringify(outcome.history ?? []),
        history_ts: input.latestTs,
        history_error: null,
      });
    else this.#saveContext(input.key, { history_error: outcome.error });
  }

  #applyRun(request: RequestRow, now: Date): void {
    const key = request.card_key ?? "";
    const proposal = runProposalOf(request);
    if (answersConversation(proposal.steps)) {
      this.#closeCard(key, now);
      return;
    }
    this.#db.prepare("UPDATE cards SET proposal = NULL, error = NULL WHERE key = ?").run(key);
    this.#appendTurn(key, {
      author: "claude",
      text: `Done: ${proposal.summary}`,
      at: iso(now),
      tools: [],
      isFailed: false,
    });
  }

  #appendTurn(key: string, turn: ActionTurn): void {
    const row = this.#db.prepare("SELECT actions FROM card_context WHERE key = ?").get(key) as
      | { actions: string }
      | undefined;
    const actions = row === undefined ? [] : (JSON.parse(row.actions) as ActionTurn[]);
    this.#saveContext(key, { actions: JSON.stringify([...actions, turn]) });
  }

  #saveContext(key: string, fields: Partial<Record<keyof ContextRow, string | null>>): void {
    if (this.#db.prepare("SELECT key FROM cards WHERE key = ?").get(key) === undefined) return;
    this.#db.prepare("INSERT OR IGNORE INTO card_context (key) VALUES (?)").run(key);
    for (const [column, value] of Object.entries(fields))
      this.#db.prepare(`UPDATE card_context SET ${column} = ? WHERE key = ?`).run(value, key);
  }

  #enqueue(kind: RequestKind, cardKey: string | null, input: unknown, now: Date): boolean {
    if (cardKey !== null) {
      if (this.#db.prepare("SELECT key FROM cards WHERE key = ?").get(cardKey) === undefined)
        return false;
      if (this.#db.prepare("SELECT id FROM requests WHERE card_key = ?").get(cardKey) !== undefined)
        return false;
    } else if (
      this.#db
        .prepare(`SELECT id FROM requests WHERE kind = ? AND input = ? AND kind != 'lookup'`)
        .get(kind, JSON.stringify(input)) !== undefined
    ) {
      return false;
    }
    this.#db
      .prepare(
        `INSERT INTO requests (kind, card_key, input, status, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?)`,
      )
      .run(kind, cardKey, JSON.stringify(input), iso(now), iso(now));
    return true;
  }

  #saveInboxCard(card: InboxCard, before: CardRow | undefined, sync: SyncInput): void {
    const messages = JSON.stringify(card.messages);
    const keys = ticketKeys(
      card.messages.map((message) => message.text).join("\n"),
      sync.projectKeys,
    );
    if (before?.messages === messages) return;
    this.#db
      .prepare(
        `INSERT INTO cards (key, kind, title, channel_id, thread_ts, messages, ticket_keys, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET title = excluded.title, messages = excluded.messages, ticket_keys = excluded.ticket_keys, updated_at = excluded.updated_at`,
      )
      .run(
        card.key,
        card.kind,
        card.title,
        card.target.channelId,
        card.target.threadTs,
        messages,
        JSON.stringify(keys),
        tsToIso(card.messages.at(-1)?.ts ?? "0"),
      );
    for (const key of keys) this.#trackTicket(key, sync.syncedAt);
  }

  #trackTicket(issueKey: string, now: Date): void {
    const inserted = this.#db
      .prepare(`INSERT OR IGNORE INTO tickets (key, status, updated_at) VALUES (?, 'loading', ?)`)
      .run(issueKey, iso(now));
    if (inserted.changes > 0) this.#enqueue("details", null, { issueKey }, now);
  }

  #applyPriorities(asked: RankingCard[], priorities: CardPriority[]): void {
    const byKey = new Map(priorities.map((entry) => [entry.key, entry]));
    const update = this.#db.prepare(
      "UPDATE cards SET priority = COALESCE(?, priority), priority_reason = COALESCE(?, priority_reason), priority_ts = ? WHERE key = ?",
    );
    for (const card of asked) {
      const ranked = byKey.get(card.key);
      update.run(ranked?.priority ?? null, ranked?.reason ?? null, card.ts, card.key);
    }
  }

  #rememberPeople(people: Recipient[], now: Date): void {
    const upsert = this.#db.prepare(
      "INSERT INTO people (channel_id, label, kind, seen_at) VALUES (?, ?, ?, ?) ON CONFLICT(channel_id) DO UPDATE SET label = excluded.label, kind = excluded.kind, seen_at = excluded.seen_at",
    );
    for (const person of people) upsert.run(person.channelId, person.label, person.kind, iso(now));
  }

  #forgetUnusedTickets(): void {
    const used = new Set(
      (
        this.#db.prepare("SELECT ticket_keys FROM cards").all() as { ticket_keys: string }[]
      ).flatMap((row) => JSON.parse(row.ticket_keys) as string[]),
    );
    for (const { key } of this.#db.prepare("SELECT key FROM tickets").all() as { key: string }[]) {
      if (!used.has(key)) this.#db.prepare("DELETE FROM tickets WHERE key = ?").run(key);
    }
  }

  #closeCard(key: string, now: Date): void {
    const row = this.#db.prepare("SELECT * FROM cards WHERE key = ?").get(key) as
      | CardRow
      | undefined;
    if (row === undefined) return;
    const ts = lastTs(messagesOf(row));
    if (row.kind !== "compose" && ts !== null) {
      this.#db
        .prepare(
          "INSERT INTO ignored (key, last_ts, ignored_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET last_ts = excluded.last_ts, ignored_at = excluded.ignored_at",
        )
        .run(key, ts, iso(now));
    }
    this.#deleteCard(key);
    this.#forgetUnusedTickets();
  }

  #deleteCard(key: string): void {
    this.#db.prepare("DELETE FROM cards WHERE key = ?").run(key);
    this.#db.prepare("DELETE FROM card_context WHERE key = ?").run(key);
    this.#db.prepare("DELETE FROM requests WHERE card_key = ?").run(key);
  }

  #meta<T>(key: string): T | null {
    const row = this.#db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row === undefined ? null : (JSON.parse(row.value) as T);
  }

  #setMeta(key: string, value: unknown): void {
    this.#db
      .prepare(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(key, JSON.stringify(value));
  }

  #transaction<T>(work: () => T): T {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.#db.exec("COMMIT");
      return result;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }
}
