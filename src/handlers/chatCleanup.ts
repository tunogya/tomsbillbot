/**
 * Chat cleanup handler.
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
import { escapeHtml } from "../utils/telegram";
import { getT } from "../i18n";
import type { BotContext } from "../env";
import { sendTelegramMessage } from "../utils/bot";

export function registerChatCleanupHandler(
  bot: Bot<BotContext>
): void {
  bot.on("my_chat_member", async (ctx) => {
    const update = ctx.myChatMember;
    const chatType = update.chat.type;
    if (chatType !== "group" && chatType !== "supergroup") return;

    const newStatus = update.new_chat_member.status;
    if (newStatus !== "left" && newStatus !== "kicked") return;

    const chatId = update.chat.id;
    const chatTitle = ("title" in update.chat ? update.chat.title : null) ?? `Chat ${chatId}`;
    const { db, botToken } = ctx;

    try {
      // Step 1: Auto-complete active work sessions
      const activeSessions = await getAllActiveSessionsByChat(db, chatId);
      const endTime = nowTs();
      const affectedCustomerIds = new Set<number>();

      for (const session of activeSessions) {
        affectedCustomerIds.add(session.customer_id);
      }

      await Promise.all(activeSessions.map(async (session) => {
        const granularity = await getGranularity(db, session.customer_id, chatId);
        const duration = durationMinutes(session.start_time, endTime, granularity);
        await completeWorkSession(db, session.id, endTime, duration);
      }));

      // Generate invoices
      await Promise.all(Array.from(affectedCustomerIds).map(async (customerId) => {
        const uninvoiced = await getUninvoicedSessions(db, customerId, chatId);
        if (uninvoiced.length === 0) return;
        const unitAmount = await getUnitAmount(db, customerId, chatId);
        if (unitAmount > 0) {
          await createInvoice(db, customerId, chatId, uninvoiced, unitAmount);
        }
      }));

      // Step 2: DM bill backups
      const openInvoices = await getOpenInvoicesByChat(db, chatId);
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

        const metadata = customer ? parseMetadata(customer.metadata) : {};
        const lang = metadata.language || "en";
        const t = getT(lang);

        const unpaid = Math.max(0, summary.total_invoiced - summary.total_paid);

        const lines = [
          t("cleanup_backup_title", { title: escapeHtml(chatTitle) }),
          "",
          t("cleanup_backup_intro"),
          "",
          t("cleanup_backup_open_invoices", { count: invoices.length }),
        ];

        for (const inv of invoices) {
          lines.push(t("cleanup_backup_invoice_item", { id: inv.id, amount: formatAmount(inv.amount_due) }));
        }

        lines.push(
          "",
          `<b>${t("cleanup_backup_balance_title")}</b>`,
          t("cleanup_backup_balance_invoiced", { amount: formatAmount(summary.total_invoiced) }),
          t("cleanup_backup_balance_paid", { amount: formatAmount(summary.total_paid) }),
          t("cleanup_backup_balance_unpaid", { amount: formatAmount(unpaid) }),
        );

        if (customer?.payment_address) {
          lines.push("", t("invoice_pay_to", { address: escapeHtml(customer.payment_address) }));
        }

        if (metadata.remark) {
          lines.push(t("invoice_remark", { remark: escapeHtml(metadata.remark) }));
        }

        lines.push("", t("cleanup_backup_footer"));

        await sendTelegramMessage(botToken, customerId, lines.join("\n"));
      }

      // Step 3: Delete all group data
      await resetGroupData(db, chatId);
    } catch (err) {
      console.error(`[chatCleanup] Failed for chat ${chatId}:`, err);
    }
  });
}
