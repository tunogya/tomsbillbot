# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## What This Is

A Telegram bot ("Tom's Bill Bot") for freelancer work-hour tracking and invoicing, deployed as a Cloudflare Worker. Built with grammY (Telegram bot framework) and Hono (HTTP router).

## Commands

- `npm run dev` - local dev server via wrangler
- `npm run deploy` - deploy to Cloudflare (runs D1 migrations first via `predeploy`)
- `npm run test` - dry-run deploy (type-checks and bundles, no actual tests executed)
- `npm run migrate:local` - apply D1 migrations locally
- `npm run cf-typegen` - regenerate `worker-configuration.d.ts` from wrangler bindings

## Architecture

**Request flow:** Telegram webhook → `POST /webhook` (Hono) → Cloudflare Queue → Queue consumer → grammY bot → D1/KV

The webhook endpoint is stateless: it validates the secret header, pushes the raw Telegram update to a Queue, and returns 200 immediately. The queue consumer processes updates sequentially within each batch, using a module-level `currentCtx` variable to pass `HandlerContext` (DB, KV, botToken) into grammY middleware.

**Cloudflare bindings:**
- `DB` - D1 database (SQLite). All amounts in cents, all timestamps in Unix seconds.
- `KV` - idempotency cache (dedup `update_id`), rate limiting, and scheduled-task reminder dedup.
- `QUEUE` - Queue for async update processing. Dead-letter queue: `billbot-dlq`.

**Cron trigger** (`0 */6 * * *`): auto-closes sessions >24h, reminds about stale sessions >12h, reminds about unpaid invoices >7 days. Implemented in `src/services/scheduled.ts`.

## Data Model

Stripe-inspired object hierarchy in D1 (schema in `migrations/0001_schema.sql`):

- `customers` - keyed by Telegram `user_id`. Stores payment address and metadata (remark).
- `prices` - per-customer per-group hourly rate. `chat_id = 0` is the global default. Metadata stores `granularity_minutes`.
- `work_sessions` - active/completed. A `UNIQUE` partial index (`idx_active_session`) enforces one active session per user per group at the DB level.
- `invoices` → `invoice_line_items` - generated from uninvoiced completed sessions.
- `payments` - linked to the latest open invoice when recorded.
- `balance_transactions` - unified ledger. Positive = receivable (invoice), negative = received (payment).

## Handler Pattern

Each handler file exports a `register*Handler(bot, getCtx)` function that registers grammY commands. `getCtx()` returns the current `HandlerContext` - call it inside the handler callback, not at registration time.

Bot middleware auto-quotes replies in group chats and enforces per-user rate limiting (20 commands/min via KV).

## Key Conventions

- DM-only commands: `/settings`, `/export` (legacy: `/setrate`, `/setaddress`, `/setremark`, `/setgranularity`)
- Group commands: `/work`, `/done`, `/invoice`, `/invoices`, `/paid`, `/balance`, `/reset`, `/discard`, `/undo`, `/stats`, `/sessions`, `/void`, `/settle`
- Duration billing rounds up to the nearest granularity block (default 30 min)
- The `test` script is a dry-run deploy (`wrangler deploy --dry-run`), not a vitest run. Vitest config exists at `tests/vitest.config.mts` but is not wired to an npm script.
