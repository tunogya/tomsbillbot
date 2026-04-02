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
  SESSION_STATUS,
  INVOICE_STATUS,
} from "../services/db";
import { nowTs, durationMinutes, formatDuration, formatAmount } from "../utils/time";
import type { BotContext } from "../env";
import { sendTelegramMessage } from "../utils/bot";

export function registerChatCleanupHandler(
  bot: Bot<BotContext>
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
    const { db, botToken } = ctx;

    try {
      // ── Step 1: Auto-complete active work sessions ──────────────
      const activeSessions = await getAllActiveSessionsByChat(db, chatId);
      const endTime = nowTs();

      // Track which customers had sessions auto-completed, so we can invoice them
      const affectedCustomerIds = new Set<number>();

      for (const session of activeSessions) {
        affectedCustomerIds.add(session.customer_id);
      }

      // Parallelize granularity fetch and completion
      await Promise.all(activeSessions.map(async (session) => {
        const granularity = await getGranularity(db, session.customer_id, chatId);
        const duration = durationMinutes(session.start_time, endTime, granularity);
        await completeWorkSession(db, session.id, endTime, duration);
        console.log(
          `[chatCleanup] Auto-completed session #${session.id} ` +
          `(customer ${session.customer_id}, ${formatDuration(duration)} hrs)`
        );
      }));

      // Generate invoices for customers with uninvoiced sessions (parallelized)
      await Promise.all(Array.from(affectedCustomerIds).map(async (customerId) => {
        const uninvoiced = await getUninvoicedSessions(db, customerId, chatId);
        if (uninvoiced.length === 0) return;

        const unitAmount = await getUnitAmount(db, customerId, chatId);
        if (unitAmount <= 0) {
          console.warn(
            `[chatCleanup] Skipping invoice for customer ${customerId} - no rate configured`
          );
          return;
        }

        const invoice = await createInvoice(db, customerId, chatId, uninvoiced, unitAmount);
        console.log(
          `[chatCleanup] Auto-created invoice #${invoice.id} for customer ${customerId} ($${formatAmount(invoice.total)})`
        );
      }));

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
        const [summary, customer] = await Promise.all([
          getInvoiceSummary(db, customerId, chatId),
          getCustomer(db, customerId)
        ]);
        const unpaid = Math.max(0, summary.total_invoiced - summary.total_paid);

        const lines = [
          `*Bill Backup - ${chatTitle}*`,
          ``,
          `The bot was removed from the group. Here is your billing summary:`,
          ``,
          `*Open Invoices (${invoices.length}):*`,
        ];

        for (const inv of invoices) {
          lines.push(
            `• Invoice #${inv.id} - \`$${formatAmount(inv.amount_due)}\` due`
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
            `[chatCleanup] Could not DM customer ${customerId} - ` +
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
