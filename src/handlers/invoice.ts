/**
 * Invoice handler.
 * /invoice — compute total hours (uninvoiced), generate invoice.
 */

import type { Context } from "grammy";
import {
  getUser,
  getUserChatRate,
  getUninvoicedSessions,
  createInvoice,
  markSessionsInvoiced,
  getTotalPayments,
  getTotalInvoiced,
} from "../services/db";
import { formatHours } from "../utils/time";
import type { HandlerContext } from "../env";

export function registerInvoiceHandler(bot: {
  command: (cmd: string, handler: (ctx: Context) => Promise<void>) => void;
}, getCtx: () => HandlerContext): void {

  bot.command("invoice", async (ctx) => {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (!userId || !chatId) return;

    if (ctx.chat.type === "private") {
      await ctx.reply("❌ The `/invoice` command can only be used in group chats.", {
        parse_mode: "Markdown",
      });
      return;
    }

    const { db } = getCtx();

    // Get user config
    const user = await getUser(db, userId);
    // Get specific rate for this chat
    const rate = await getUserChatRate(db, userId, chatId);

    if (rate <= 0) {
      await ctx.reply(
        "❌ Your hourly rate for this chat is not set. Use `/setrate <amount>` first.",
        { parse_mode: "Markdown" }
      );
      return;
    }

    // Get uninvoiced completed sessions in this chat
    const sessions = await getUninvoicedSessions(db, userId, chatId);
    if (sessions.length === 0) {
      await ctx.reply("📋 No uninvoiced work sessions found in this chat.");
      return;
    }

    // Calculate totals
    const totalHours = sessions.reduce((sum, s) => sum + (s.duration ?? 0), 0);
    const totalAmount = totalHours * rate;

    // Create invoice record
    const invoice = await createInvoice(db, userId, chatId, totalAmount);

    // Mark sessions as invoiced
    const sessionIds = sessions.map((s) => s.id);
    await markSessionsInvoiced(db, sessionIds);

    // Get payment history for balance in this chat
    const totalPaid = await getTotalPayments(db, userId, chatId);
    const totalInvoiced = await getTotalInvoiced(db, userId, chatId);
    const unpaidAmount = totalInvoiced - totalPaid;

    const lines = [
      `*Invoice #${invoice.id}*`,
      `• Sessions: ${sessions.length}`,
      `• Total Hours: \`${formatHours(totalHours)}\``,
      `• Rate: \`${rate}/hr\``,
      `• Amount: \`$${totalAmount.toFixed(2)}\``,
      "",
      `*Balance:*`,
      `• Total Invoiced: \`$${totalInvoiced.toFixed(2)}\``,
      `• Total Paid: \`$${totalPaid.toFixed(2)}\``,
      "",
      `• Unpaid: \`$${unpaidAmount.toFixed(2)}\``,
    ];

    if (user?.payment_address) {
      lines.push("", `💳 Pay to: \`${user.payment_address}\``);
    }

    if (user?.remark) {
      lines.push(`📝 Remark: ${user.remark}`);
    }

    await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
  });
}
