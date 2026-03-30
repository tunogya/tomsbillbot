/**
 * Chat cleanup handler.
 *
 * Listens for `my_chat_member` updates where the bot's status transitions to
 * "left" or "kicked". When triggered:
 *
 * 1. Auto-completes all active work sessions in the group
 * 2. Generates invoices for uninvoiced completed sessions
 * 3. DMs bill backups to users with unsettled invoices
 * 4. Deletes all data for the chat
 */

import type { Bot } from "grammy";
import {
  resetGroupData,
  getAllActiveSessionsByChat,
  completeWorkSession,
  getUninvoicedSessions,
  getUnitAmount,
  getGranularity,
  createInvoice,
  getOpenInvoicesByChat,
  getInvoiceSummary,
  getCustomer,
  parseMetadata,
} from "../services/db";
import { nowTs, durationMinutes, formatDuration, formatAmount } from "../utils/time";
import type { HandlerContext } from "../env";

/** Send a Telegram message via Bot API (plain fetch, no grammY needed). */
async function sendTelegramMessage(
  botToken: string,
  chatId: number,
  text: string
): Promise<boolean> {
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
    const body = await resp.text();
    console.warn(`[chatCleanup] DM failed for chat ${chatId}: ${resp.status} ${body}`);
    return false;
  }
  return true;
}

export function registerChatCleanupHandler(
  bot: Bot,
  getCtx: () => HandlerContext
): void {
  bot.on("my_chat_member", async (ctx) => {
    const update = ctx.myChatMember;

    // Only act on group / supergroup chats
    const chatType = update.chat.type;
    if (chatType !== "group" && chatType !== "supergroup") return;

    const newStatus = update.new_chat_member.status;

    // "left" → bot was removed (or group dissolved)
    // "kicked" → bot was explicitly banned
    if (newStatus !== "left" && newStatus !== "kicked") return;

    const chatId = update.chat.id;
    const chatTitle = ("title" in update.chat ? update.chat.title : null) ?? `Chat ${chatId}`;
    const { db, botToken } = getCtx();

    try {
      // ── Step 1: Auto-complete active work sessions ──────────────
      const activeSessions = await getAllActiveSessionsByChat(db, chatId);
      const endTime = nowTs();

      // Track which customers had sessions auto-completed, so we can invoice them
      const affectedCustomerIds = new Set<number>();

      for (const session of activeSessions) {
        const granularity = await getGranularity(db, session.customer_id, chatId);
        const duration = durationMinutes(session.start_time, endTime, granularity);
        await completeWorkSession(db, session.id, endTime, duration);
        affectedCustomerIds.add(session.customer_id);
        console.log(
          `[chatCleanup] Auto-completed session #${session.id} ` +
          `(customer ${session.customer_id}, ${formatDuration(duration)} hrs)`
        );
      }

      // Generate invoices for customers with uninvoiced sessions
      for (const customerId of affectedCustomerIds) {
        const uninvoiced = await getUninvoicedSessions(db, customerId, chatId);
        if (uninvoiced.length === 0) continue;

        const unitAmount = await getUnitAmount(db, customerId, chatId);
        if (unitAmount <= 0) {
          console.warn(
            `[chatCleanup] Skipping invoice for customer ${customerId} — no rate configured`
          );
          continue;
        }

        const invoice = await createInvoice(db, customerId, chatId, uninvoiced, unitAmount);
        console.log(
          `[chatCleanup] Auto-created invoice #${invoice.id} for customer ${customerId} ($${formatAmount(invoice.total)})`
        );
      }

      // ── Step 2: DM bill backups to users with open invoices ─────
      const openInvoices = await getOpenInvoicesByChat(db, chatId);

      // Group invoices by customer for a single consolidated DM per user
      const invoicesByCustomer = new Map<number, typeof openInvoices>();
      for (const inv of openInvoices) {
        const existing = invoicesByCustomer.get(inv.customer_id) ?? [];
        existing.push(inv);
        invoicesByCustomer.set(inv.customer_id, existing);
      }

      for (const [customerId, invoices] of invoicesByCustomer) {
        const summary = await getInvoiceSummary(db, customerId, chatId);
        const unpaid = Math.max(0, summary.total_invoiced - summary.total_paid);
        const customer = await getCustomer(db, customerId);

        const lines = [
          `*Bill Backup — ${chatTitle}*`,
          ``,
          `The bot was removed from the group. Here is your billing summary:`,
          ``,
          `*Open Invoices (${invoices.length}):*`,
        ];

        for (const inv of invoices) {
          lines.push(
            `• Invoice #${inv.id} — \`$${formatAmount(inv.amount_due)}\` due`
          );
        }

        lines.push(
          ``,
          `*Balance:*`,
          `• Total Invoiced: \`$${formatAmount(summary.total_invoiced)}\``,
          `• Total Paid: \`$${formatAmount(summary.total_paid)}\``,
          `• Unpaid: \`$${formatAmount(unpaid)}\``,
        );

        if (customer?.payment_address) {
          lines.push(``, `Pay to: \`${customer.payment_address}\``);
        }

        const metadata = customer ? parseMetadata(customer.metadata) : {};
        if (metadata.remark) {
          lines.push(`Remark: ${metadata.remark}`);
        }

        lines.push(``, `_This is a backup copy. The group data has been cleared._`);

        const sent = await sendTelegramMessage(botToken, customerId, lines.join("\n"));
        if (sent) {
          console.log(`[chatCleanup] DM sent to customer ${customerId}`);
        } else {
          console.warn(
            `[chatCleanup] Could not DM customer ${customerId} — ` +
            `user may not have started private chat with the bot`
          );
        }
      }

      // ── Step 3: Delete all group data ───────────────────────────
      await resetGroupData(db, chatId);
      console.log(
        `[chatCleanup] Deleted all data for chat ${chatId} (bot status → ${newStatus}). ` +
        `Auto-completed ${activeSessions.length} session(s), DM'd ${invoicesByCustomer.size} user(s).`
      );
    } catch (err) {
      console.error(
        `[chatCleanup] Failed to process cleanup for chat ${chatId}:`,
        err
      );
      throw err;
    }
  });
}
