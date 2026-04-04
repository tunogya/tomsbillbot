import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Update } from "grammy/types";
import type { AppEnv } from "../../src/env";
import {
  createInvoice,
  getInvoiceSummary,
  getUninvoicedSessions,
  logManualWorkSession,
  recordPayment,
  setDefaultUnitAmount,
  setUnitAmount,
  updatePriceMetadata,
  upsertCustomer,
} from "../../src/services/db";
import {
  getCachedGranularity,
  getCachedUnitAmount,
  invalidateGranularityCache,
  invalidateRateCache,
} from "../../src/utils/cache";

import worker from "../../src/index";

const BOT_ID = 900001;
const BOT_USERNAME = "billbot_test";
const BOT_SECRET = "test-secret";
const BOT_TOKEN = "test-token";

type TelegramCalls = {
  answerCallbackQuery: Array<Record<string, unknown>>;
  editMessageText: Array<Record<string, unknown>>;
  getMe: number;
  sendChatAction: Array<Record<string, unknown>>;
  sendMessage: Array<Record<string, unknown>>;
};

type TestEnv = AppEnv & {
  __queue: TestQueue;
};

class TestExecutionContext {
  private readonly pending: Promise<unknown>[] = [];

  waitUntil(promise: Promise<unknown>): void {
    this.pending.push(Promise.resolve(promise));
  }

  passThroughOnException(): void {}

  async flush(): Promise<void> {
    await Promise.all(this.pending);
  }
}

class TestKVNamespace {
  private readonly store = new Map<string, { expiresAt: number | null; value: string }>();

  async get(key: string, type?: "json"): Promise<string | Record<string, unknown> | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }

    return type === "json" ? JSON.parse(entry.value) as Record<string, unknown> : entry.value;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    const expiresAt = options?.expirationTtl ? Date.now() + options.expirationTtl * 1000 : null;
    this.store.set(key, { expiresAt, value });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

class TestQueue {
  readonly sent: unknown[] = [];

  async send(message: unknown): Promise<void> {
    this.sent.push(message);
  }
}

class TestPreparedStatement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly params: unknown[] = []
  ) {}

  bind(...params: unknown[]): TestPreparedStatement {
    return new TestPreparedStatement(this.db, this.sql, params);
  }

  async first<T>(): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.params) as T | undefined;
    return row ?? null;
  }

  async all<T>(): Promise<{ results: T[] }> {
    const rows = this.db.prepare(this.sql).all(...this.params) as T[];
    return { results: rows ?? [] };
  }

  async run(): Promise<{ meta: { changes: number; last_row_id: number } }> {
    const result = this.db.prepare(this.sql).run(...this.params);
    return {
      meta: {
        changes: result.changes ?? 0,
        last_row_id: Number(result.lastInsertRowid ?? 0),
      },
    };
  }
}

class TestD1Database {
  constructor(private readonly sqlite: DatabaseSync) {}

  prepare(sql: string): TestPreparedStatement {
    return new TestPreparedStatement(this.sqlite, sql);
  }

  async batch(statements: TestPreparedStatement[]): Promise<unknown[]> {
    this.sqlite.exec("BEGIN");
    try {
      const results: unknown[] = [];
      for (const statement of statements) {
        results.push(await statement.run());
      }
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

function makeEnv(): TestEnv {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec(
    readFileSync(path.resolve(process.cwd(), "migrations/0001_schema.sql"), "utf8")
  );

  const queue = new TestQueue();

  return {
    BOT_SECRET,
    BOT_TOKEN,
    DB: new TestD1Database(sqlite) as unknown as D1Database,
    KV: new TestKVNamespace() as unknown as KVNamespace,
    QUEUE: queue as unknown as Queue,
    __queue: queue,
  };
}

function setupTelegramMock(): TelegramCalls {
  const calls: TelegramCalls = {
    answerCallbackQuery: [],
    editMessageText: [],
    getMe: 0,
    sendChatAction: [],
    sendMessage: [],
  };

  const telegramFetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== "https://api.telegram.org") {
      throw new Error(`Unexpected outbound request: ${url.toString()}`);
    }

    const method = url.pathname.split("/").pop();
    const text = await request.clone().text();
    const payload = text ? JSON.parse(text) as Record<string, unknown> : {};

    if (method === "getMe") {
      calls.getMe += 1;
      return Response.json({
        ok: true,
        result: {
          first_name: "Tom's Bill Bot",
          id: BOT_ID,
          is_bot: true,
          username: BOT_USERNAME,
        },
      });
    }

    if (method === "sendMessage") {
      calls.sendMessage.push(payload);
      return Response.json({
        ok: true,
        result: {
          chat: { id: payload.chat_id, type: "private" },
          date: 0,
          message_id: calls.sendMessage.length,
          text: payload.text,
        },
      });
    }

    if (method === "editMessageText") {
      calls.editMessageText.push(payload);
      return Response.json({
        ok: true,
        result: {
          chat: { id: payload.chat_id ?? -1, type: "group" },
          date: 0,
          message_id: payload.message_id ?? 1,
          text: payload.text,
        },
      });
    }

    if (method === "answerCallbackQuery") {
      calls.answerCallbackQuery.push(payload);
      return Response.json({ ok: true, result: true });
    }

    if (method === "sendChatAction") {
      calls.sendChatAction.push(payload);
      return Response.json({ ok: true, result: true });
    }

    throw new Error(`Unsupported Telegram API method: ${method}`);
  };

  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => telegramFetchImpl!(input, init));

  return calls;
}

function makeCommandUpdate(params: {
  chatId: number;
  chatType: "private" | "group" | "supergroup";
  text: string;
  updateId: number;
  userId: number;
  replyToMessage?: Record<string, unknown>;
}): Update {
  return {
    message: {
      chat: {
        id: params.chatId,
        type: params.chatType,
      },
      date: 1_700_000_000,
      from: {
        first_name: "Tester",
        id: params.userId,
        is_bot: false,
        username: "tester",
      },
      message_id: params.updateId,
      text: params.text,
      ...(params.replyToMessage ? { reply_to_message: params.replyToMessage } : {}),
    },
    update_id: params.updateId,
  } as Update;
}

let currentEnv: TestEnv | null = null;

beforeEach(() => {
  currentEnv = makeEnv();
  vi.restoreAllMocks();
});

describe("Billbot integration", () => {
  it("rejects webhook requests with an invalid secret", async () => {
    const env = currentEnv!;
    const ctx = new TestExecutionContext();
    const response = await worker.fetch(
      new Request("http://local.test/webhook", {
        body: JSON.stringify(makeCommandUpdate({
          chatId: -1000,
          chatType: "group",
          text: "/work",
          updateId: 1,
          userId: 11,
        })),
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Bot-Api-Secret-Token": "not-the-secret",
        },
        method: "POST",
      }),
      env as AppEnv,
      ctx
    );

    expect(response.status).toBe(401);
    await ctx.flush();
    expect(env.__queue.sent).toHaveLength(0);
  });

  it("accepts webhook commands and triggers typing feedback immediately", async () => {
    const env = currentEnv!;
    const calls = setupTelegramMock();
    const ctx = new TestExecutionContext();

    const response = await worker.fetch(
      new Request("http://local.test/webhook", {
        body: JSON.stringify(makeCommandUpdate({
          chatId: -2001,
          chatType: "group",
          text: "/work",
          updateId: 2,
          userId: 21,
        })),
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Bot-Api-Secret-Token": BOT_SECRET,
        },
        method: "POST",
      }),
      env as AppEnv,
      ctx
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    await ctx.flush();

    expect(calls.sendChatAction).toHaveLength(1);
    expect(calls.sendChatAction[0]).toMatchObject({
      action: "typing",
      chat_id: -2001,
    });
    expect(env.__queue.sent).toHaveLength(1);
  });

  it("tracks manual work, creates invoices, and settles payments end-to-end", async () => {
    const env = currentEnv!;
    const userId = 31;
    const chatId = -3001;

    await upsertCustomer(env.DB, userId, "Tester");
    await setDefaultUnitAmount(env.DB, userId, 10000);
    await logManualWorkSession(env.DB, userId, chatId, 90);

    const sessions = await getUninvoicedSessions(env.DB, userId, chatId);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      duration_minutes: 90,
      invoice_id: null,
      status: "completed",
    });

    const invoice = await createInvoice(env.DB, userId, chatId, sessions, 10000);

    expect(invoice).toMatchObject({
      amount_due: 15000,
      amount_paid: 0,
      status: "open",
      total: 15000,
    });

    const billedSession = await env.DB
      .prepare(
        "SELECT invoice_id FROM work_sessions WHERE customer_id = ? AND chat_id = ?"
      )
      .bind(userId, chatId)
      .first<{ invoice_id: number }>();

    expect(billedSession?.invoice_id).toBe(invoice?.id);

    const paymentResult = await recordPayment(env.DB, userId, chatId, 15000);
    expect(paymentResult.payment.amount).toBe(15000);

    const paidInvoice = await env.DB
      .prepare(
        "SELECT status, amount_due, amount_paid FROM invoices WHERE id = ?"
      )
      .bind(invoice?.id)
      .first<{ amount_due: number; amount_paid: number; status: string }>();

    expect(paidInvoice).toMatchObject({
      amount_due: 0,
      amount_paid: 15000,
      status: "paid",
    });

    const payment = await env.DB
      .prepare(
        "SELECT amount, status, invoice_id FROM payments WHERE customer_id = ? AND chat_id = ?"
      )
      .bind(userId, chatId)
      .first<{ amount: number; invoice_id: number; status: string }>();

    expect(payment).toMatchObject({
      amount: 15000,
      invoice_id: invoice?.id,
      status: "succeeded",
    });

    const summary = await getInvoiceSummary(env.DB, userId, chatId);
    expect(summary).toEqual({
      total_invoiced: 15000,
      total_paid: 15000,
    });
  });

  it("uses KV cache with proper fallback and invalidation for rate and granularity settings", async () => {
    const env = currentEnv!;
    const userId = 41;
    const chatId = -4001;

    await upsertCustomer(env.DB, userId, "Tester");
    await setDefaultUnitAmount(env.DB, userId, 7500);
    await updatePriceMetadata(env.DB, userId, 0, { granularity_minutes: 30 });

    expect(await getCachedUnitAmount(env.KV, env.DB, userId, chatId)).toBe(7500);
    expect(await getCachedGranularity(env.KV, env.DB, userId, chatId)).toBe(30);

    await setUnitAmount(env.DB, userId, chatId, 12500);
    await updatePriceMetadata(env.DB, userId, chatId, { granularity_minutes: 15 });

    expect(await getCachedUnitAmount(env.KV, env.DB, userId, chatId)).toBe(7500);
    expect(await getCachedGranularity(env.KV, env.DB, userId, chatId)).toBe(30);

    await invalidateRateCache(env.KV, userId, chatId);
    await invalidateGranularityCache(env.KV, userId, chatId);

    expect(await getCachedUnitAmount(env.KV, env.DB, userId, chatId)).toBe(12500);
    expect(await getCachedGranularity(env.KV, env.DB, userId, chatId)).toBe(15);
  });
});
