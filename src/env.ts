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
export interface HandlerContext {
  db: D1Database;
  kv: KVNamespace;
}
