/**
 * Cloudflare Worker environment bindings.
 */
export interface AppEnv {
  DB: D1Database;
  KV: KVNamespace;
  MY_QUEUE: Queue;
  BOT_TOKEN: string;
  BOT_SECRET: string;
}

/**
 * Context passed to all handlers, providing access to
 * environment bindings without module-level mutable state.
 */
import type { Context } from "grammy";
import type { TFunction } from "./i18n";

export interface BotContext extends Context {
  db: D1Database;
  kv: KVNamespace;
  botToken: string;
  t: TFunction;
}
