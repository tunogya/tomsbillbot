/**
 * Invoice handler.
 * /invoice — compute total hours (uninvoiced), generate invoice.
 */

import type { Context } from "grammy";
import {
  getUser,
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
    if (!userId) return;

    const { db } = getCtx();

    // Get user config
    const user = await getUser(db, userId);
    if (!user) {
      await ctx.reply("❌ Please use /start first to register.");
      return;
    }

    if (user.hourly_rate <= 0) {
      await ctx.reply(
        "❌ Your hourly rate is not set. Use `/setrate <amount>` first.",
        { parse_mode: "Markdown" }
      );
      return;
    }

    // Get uninvoiced completed sessions
    const sessions = await getUninvoicedSessions(db, userId);
    if (sessions.length === 0) {
      await ctx.reply("📋 No uninvoiced work sessions found.");
      return;
    }

    // Calculate totals
    const totalHours = sessions.reduce((sum, s) => sum + (s.duration ?? 0), 0);
    const totalAmount = totalHours * user.hourly_rate;

    // Create invoice record
    const invoice = await createInvoice(db, userId, totalAmount);

    // Mark sessions as invoiced
    const sessionIds = sessions.map((s) => s.id);
    await markSessionsInvoiced(db, sessionIds);

    // Get payment history for balance
    const totalPaid = await getTotalPayments(db, userId);
    const totalInvoiced = await getTotalInvoiced(db, userId);
    const unpaidAmount = totalInvoiced - totalPaid;

    const lines = [
      `🧾 *Invoice #${invoice.id}*`,
      "",
      `📊 *This Invoice:*`,
      `• Sessions: ${sessions.length}`,
      `• Total Hours: \`${formatHours(totalHours)}\``,
      `• Rate: \`$${user.hourly_rate}/hr\``,
      `• Amount: \`$${totalAmount.toFixed(2)}\``,
      "",
      `💰 *Balance:*`,
      `• Total Invoiced: \`$${totalInvoiced.toFixed(2)}\``,
      `• Total Paid: \`$${totalPaid.toFixed(2)}\``,
      `• Unpaid: \`$${unpaidAmount.toFixed(2)}\``,
    ];

    if (user.payment_address) {
      lines.push("", `💳 Pay to: \`${user.payment_address}\``);
    }

    await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
  });
}
