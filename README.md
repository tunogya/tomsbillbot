# Tom's Bill Bot 🎩💸

Howdy! 🐴 I'm **Tom's Bill Bot**, your personal, high-concurrency, serverless Telegram assistant built on Cloudflare Workers for tracking work hours and invoicing. 

I'm designed to help freelancers and teams clock time across different Telegram groups, ensure exact idempotent updates, and manage crypto-invoicing seamlessly-all without breaking a sweat over scaling issues! 🤖

## 💡 Philosophy

> **Time should be respected, not sold in packages.**

By default, billing is calculated in 30-minute increments, as real work rarely fits neatly into one hour. Every minute of dedication deserves to be precisely recorded, not rounded off, lost, or dismissed as "not worth mentioning." The purpose of this tool is to ensure that no minute of labor goes to waste.

## 🤖 Try It Now

👉 **[@TomsBillBot](https://t.me/TomsBillBot)** - Free to use, open to everyone.

## 🏗️ Architecture & Tech Stack

The bot uses a **stateless webhook-to-queue architecture** to decouple the fast ingestion of Telegram updates from the heavier processing logic (database transactions, external dependencies).

- **Runtime:** [Cloudflare Workers](https://workers.cloudflare.com/)
- **Bot Framework:** [grammY](https://grammy.dev/)
- **Webhook Router:** [Hono](https://hono.dev/)
- **Database:** Cloudflare **D1** (Serverless SQLite)
- **Message Broker:** Cloudflare **Queues**
- **Idempotency Cache:** Cloudflare **KV**

### The Request Flow
1. **Webhook Receiver:** Telegram sends an update `POST /webhook` to the Hono app. The app verifies the webhook secret, pushes the raw update to a Cloudflare Queue, and immediately responds with HTTP 200 to prevent Telegram from retrying.
2. **Queue Consumer:** The Cloudflare Queue processes batches of updates in the background.
3. **Idempotency Check:** Before processing, I check the `update_id` against KV storage. If it's a duplicate, I skip it!
4. **Execution:** My trusty grammY core executes command logic against the D1 database.
5. **Concurrency Safety:** Active work sessions are protected by a `UNIQUE` partial index in the SQLite database to prevent race conditions during concurrent `/work` commands.

## ✨ Features and Commands

### ⚙️ User Configuration (DM & Group)
- `/settings` - **Interactive Dashboard** (Recommended). Manage your rate, granularity, and payment details via a visual menu.
- `/setrate <amount>` - Set your hourly rate (e.g., `/setrate 50`).
- `/setaddress <address>` - Set your payment address (e.g., USDT address).
- `/setremark <text>` - Set a custom note shown on your invoices.
- `/setgranularity <minutes>` - Set billing time granularity (e.g., `30` for 30-minute blocks).
- `/export` - (DM only) Download your entire history of invoices and sessions as CSV files.

### ⏱️ Work Tracking (Group Commands)
- `/work` - Start a new work session timer.
- `/work <hours>` - **Manual Log**. Record a specific duration (e.g., `/work 1.5`).
- `/done` - End your active work session and record the duration.
- `/discard` - Cancel your currently active timer (requires confirmation).
- `/undo` - Revert your last recorded session or active timer (requires confirmation).

### 🧾 Invoicing & Payments
- `/invoice` - Generate an invoice from all uninvoiced sessions.
- `/sessions` - List all uninvoiced work sessions before billing.
- `/invoices` - List the 5 most recent invoices with inline **Void** and **Pay** buttons.
- `/void <id>` - Cancel a specific invoice (author only, requires confirmation).
- `/balance` - Check your credit/debit balance from past invoices and payments.
- `/paid <amount>` - Record a payment against your current unpaid balance (requires confirmation).
- `/settle` - Automatically record a payment for your entire outstanding balance (requires confirmation).
- `/stats` - View your weekly and monthly work statistics and estimated earnings.
- `/reset` - Reset all historical data for the current group (admin only, requires confirmation).

## 🚀 Getting Started

### Prerequisites
- Node.js & npm
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)
- A Telegram Bot Token from [@BotFather](https://t.me/botfather)

### 1. Provision Cloudflare Resources
You will need to create a D1 database, a KV namespace, and a Queue in your Cloudflare account.

```bash
# Create D1 Database
npx wrangler d1 create billbot-db

# Create KV Namespace
npx wrangler kv:namespace create KV

# Create Queue
npx wrangler queues create billbot
```
*Note: Update `wrangler.jsonc` with the generated IDs for your D1 database and KV namespace.*

### 2. Apply Database Migrations
Initialize your D1 database with the required tables and indexes:
```bash
npm run predeploy
```
*(Or use `npm run migrate:local` for local development).*

### 3. Deploy the Worker
Publish the worker to Cloudflare:
```bash
npm run deploy
```

### 4. Setup Secrets & Webhook
Set your production secrets:
```bash
npx wrangler secret put BOT_TOKEN
npx wrangler secret put BOT_SECRET
```
*(Where `BOT_SECRET` is a random string used to verify incoming webhooks).*

Finally, register your Webhook with Telegram:
```text
https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://<YOUR_WORKER_DOMAIN>/webhook&secret_token=<YOUR_BOT_SECRET>
```

## 🧪 Testing

The bot includes Vitest for integration testing. You can run tests without deploying using:
```bash
npm run test
```

## 📜 Project Structure

```text
src/
├── index.ts           # Hono router, Webhook handler, and Queue consumer logic
├── env.ts             # Cloudflare bindings and Environment definitions
├── bot.ts             # grammY bot initialization
├── handlers/          # Telegram command handlers (start, config, work, invoice, payment)
├── services/          # Database interaction layer (D1)
└── utils/             # Utility functions (idempotency, time parsing)
migrations/            # D1 SQLite schema migrations
```
