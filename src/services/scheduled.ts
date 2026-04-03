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
import { nowTs, durationMinutes, formatDuration, formatAmount, computeAmount } from "../utils/time";
import { sendTelegramMessage } from "../utils/bot";
import { escapeHtml } from "../utils/telegram";
import { getCustomersForSummary, getUserGlobalUnbilled, parseMetadata } from "./db";

const STALE_THRESHOLD = 12 * 60 * 60; // 12 hours in seconds
const ABANDON_THRESHOLD = 24 * 60 * 60; // 24 hours in seconds
const INVOICE_REMIND_THRESHOLD = 7 * 24 * 60 * 60; // 7 days in seconds
const DAY_IN_SECONDS = 24 * 60 * 60;
const WEEK_IN_SECONDS = 7 * 24 * 60 * 60;

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

/**
 * Main scheduled handler - called by Cron Trigger.
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
      `⏰ <b>Auto-closed session</b> for user <code>${escapeHtml(session.customer_id.toString())}</code>\n\n` +
      `Session #${session.id} was active for over 24 hours and has been automatically closed.\n` +
      `Duration: <code>${escapeHtml(formatDuration(duration))} hours</code>\n\n` +
      `<i>If this was unintentional, please start a new session with /work.</i>`
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
      `⚠️ <b>Reminder:</b> User <code>${escapeHtml(session.customer_id.toString())}</code> has a work session running for <code>${escapeHtml(formatDuration(elapsed))} hours</code>.\n\n` +
      `Don't forget to use /done when finished!\n` +
      `<i>Sessions are auto-closed after 24 hours.</i>`
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
    // Use KV to avoid spamming - remind at most once per 7 days
    const reminderKey = `reminder:invoice:${inv.id}`;
    const alreadyReminded = await env.KV.get(reminderKey);
    if (alreadyReminded) continue;

    await sendTelegramMessage(
      env.BOT_TOKEN,
      inv.chat_id,
      `📬 <b>Invoice #${inv.id} Reminder</b>\n\n` +
      `User <code>${escapeHtml(inv.customer_id.toString())}</code> has an unpaid invoice of <code>$${formatAmount(inv.amount_due)}</code>.\n` +
      `Use /paid to record a payment.`
    );

    // Don't re-remind for another 7 days
    await env.KV.put(reminderKey, "1", { expirationTtl: INVOICE_REMIND_THRESHOLD });

    console.log(`[scheduled] Reminded about unpaid invoice #${inv.id}`);
  }

  // ── 4. Send Work Summaries (Daily/Weekly) ─────────────────────
  const summaryUsers = await getCustomersForSummary(env.DB);
  for (const customer of summaryUsers) {
    const metadata = parseMetadata(customer.metadata);
    const freq = metadata.summary_frequency;
    if (!freq || freq === "off") continue;

    const interval = freq === "daily" ? DAY_IN_SECONDS : WEEK_IN_SECONDS;
    const lastSummaryKey = `last_summary:${customer.id}`;
    const lastSummaryTsStr = await env.KV.get(lastSummaryKey);
    const lastSummaryTs = lastSummaryTsStr ? parseInt(lastSummaryTsStr, 10) : 0;

    if (now - lastSummaryTs < interval) continue;

    // Time for summary!
    const unbilled = await getUserGlobalUnbilled(env.DB, customer.id);
    if (unbilled.length === 0) {
      // Still update the timestamp so we don't keep checking every 6h if they have no work
      await env.KV.put(lastSummaryKey, now.toString());
      continue;
    }

    let totalMins = 0;
    let totalCents = 0;
    const lines = [
      `📊 <b>Your ${freq.charAt(0).toUpperCase() + freq.slice(1)} Work Summary</b>`,
      "",
    ];

    for (const group of unbilled) {
      const amount = computeAmount(group.unbilled_minutes, group.unit_amount);
      totalMins += group.unbilled_minutes;
      totalCents += amount;
      lines.push(`• Group <code>${group.chat_id}</code>: ${formatDuration(group.unbilled_minutes)}h ($${formatAmount(amount)})`);
    }

    lines.push(
      "",
      `<b>Total Unbilled:</b> <code>${formatDuration(totalMins)} hours</code>`,
      `<b>Estimated Value:</b> <code>$${formatAmount(totalCents)}</code>`,
      "",
      `<i>You can change summary frequency in /settings</i>`
    );

    // Send DM
    try {
      await sendTelegramMessage(env.BOT_TOKEN, customer.id, lines.join("\n"));
      await env.KV.put(lastSummaryKey, now.toString());
      console.log(`[scheduled] Sent ${freq} summary to user ${customer.id}`);
    } catch (err) {
      console.error(`[scheduled] Failed to send summary to user ${customer.id}:`, err);
    }
  }
}
