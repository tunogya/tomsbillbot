/**
 * Scheduled (Cron Trigger) handler.
 *
 * Runs periodically to:
 * 1. Remind users with stale active sessions (> 12 hours)
 * 2. Auto-close abandoned sessions (> 24 hours)
 * 3. Remind about unpaid invoices (> 7 days)
 *
 * Messages are sent to the group chat where the session/invoice belongs.
 */

import type { AppEnv } from "../env";
import { nowTs, durationMinutes, formatDuration } from "../utils/time";

const STALE_THRESHOLD = 12 * 60 * 60; // 12 hours in seconds
const ABANDON_THRESHOLD = 24 * 60 * 60; // 24 hours in seconds
const INVOICE_REMIND_THRESHOLD = 7 * 24 * 60 * 60; // 7 days in seconds

interface StaleSession {
  id: number;
  customer_id: number;
  chat_id: number;
  start_time: number;
}

interface UnpaidInvoice {
  id: number;
  customer_id: number;
  chat_id: number;
  amount_due: number;
  created: number;
}

/** Send a Telegram message via Bot API (plain fetch, no grammY needed). */
async function sendTelegramMessage(
  botToken: string,
  chatId: number,
  text: string
): Promise<void> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
    }),
  });
  if (!resp.ok) {
    console.error(`[scheduled] Failed to send message to chat ${chatId}:`, await resp.text());
  }
}

/**
 * Main scheduled handler — called by Cron Trigger.
 */
export async function handleScheduled(env: AppEnv): Promise<void> {
  const now = nowTs();

  // ── 1. Auto-close abandoned sessions (> 24h) ──────────────────
  const abandonedSessions = await env.DB
    .prepare(
      `SELECT id, customer_id, chat_id, start_time FROM work_sessions
       WHERE status = 'active' AND start_time < ?`
    )
    .bind(now - ABANDON_THRESHOLD)
    .all<StaleSession>();

  for (const session of abandonedSessions.results ?? []) {
    const endTime = now;
    const duration = durationMinutes(session.start_time, endTime);

    await env.DB
      .prepare(
        `UPDATE work_sessions
         SET status = 'completed', end_time = ?, duration_minutes = ?
         WHERE id = ? AND status = 'active'`
      )
      .bind(endTime, duration, session.id)
      .run();

    await sendTelegramMessage(
      env.BOT_TOKEN,
      session.chat_id,
      `⏰ *Auto-closed session* for user \`${session.customer_id}\`\n\n` +
      `Session #${session.id} was active for over 24 hours and has been automatically closed.\n` +
      `Duration: \`${formatDuration(duration)} hours\`\n\n` +
      `_If this was unintentional, please start a new session with /work._`
    );

    console.log(`[scheduled] Auto-closed session #${session.id} (${formatDuration(duration)} hrs)`);
  }

  // ── 2. Remind stale sessions (> 12h but <= 24h) ───────────────
  const staleSessions = await env.DB
    .prepare(
      `SELECT id, customer_id, chat_id, start_time FROM work_sessions
       WHERE status = 'active'
         AND start_time < ?
         AND start_time >= ?`
    )
    .bind(now - STALE_THRESHOLD, now - ABANDON_THRESHOLD)
    .all<StaleSession>();

  for (const session of staleSessions.results ?? []) {
    // Use KV to avoid sending duplicate reminders for the same session
    const reminderKey = `reminder:session:${session.id}`;
    const alreadyReminded = await env.KV.get(reminderKey);
    if (alreadyReminded) continue;

    const elapsed = durationMinutes(session.start_time, now);

    await sendTelegramMessage(
      env.BOT_TOKEN,
      session.chat_id,
      `⚠️ *Reminder:* User \`${session.customer_id}\` has a work session running for \`${formatDuration(elapsed)} hours\`.\n\n` +
      `Don't forget to use /done when finished!\n` +
      `_Sessions are auto-closed after 24 hours._`
    );

    // Mark as reminded (TTL = 24h so it won't re-remind)
    await env.KV.put(reminderKey, "1", { expirationTtl: ABANDON_THRESHOLD });

    console.log(`[scheduled] Reminded about stale session #${session.id}`);
  }

  // ── 3. Remind unpaid invoices (> 7 days) ──────────────────────
  const unpaidInvoices = await env.DB
    .prepare(
      `SELECT id, customer_id, chat_id, amount_due, created FROM invoices
       WHERE status = 'open' AND created < ?`
    )
    .bind(now - INVOICE_REMIND_THRESHOLD)
    .all<UnpaidInvoice>();

  for (const inv of unpaidInvoices.results ?? []) {
    // Use KV to avoid spamming — remind at most once per 7 days
    const reminderKey = `reminder:invoice:${inv.id}`;
    const alreadyReminded = await env.KV.get(reminderKey);
    if (alreadyReminded) continue;

    const amountStr = (inv.amount_due / 100).toFixed(2);

    await sendTelegramMessage(
      env.BOT_TOKEN,
      inv.chat_id,
      `📬 *Invoice #${inv.id} Reminder*\n\n` +
      `User \`${inv.customer_id}\` has an unpaid invoice of \`$${amountStr}\`.\n` +
      `Use /paid to record a payment.`
    );

    // Don't re-remind for another 7 days
    await env.KV.put(reminderKey, "1", { expirationTtl: INVOICE_REMIND_THRESHOLD });

    console.log(`[scheduled] Reminded about unpaid invoice #${inv.id}`);
  }
}
