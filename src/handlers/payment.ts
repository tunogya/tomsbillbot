/**
 * Payment handler.
 * /paid <amount> — record a payment and update balance.
 */

import type { Context } from "grammy";
import {
  recordPayment,
  getTotalPayments,
  getTotalInvoiced,
} from "../services/db";
import type { HandlerContext } from "../env";

export function registerPaymentHandler(bot: {
  command: (cmd: string, handler: (ctx: Context) => Promise<void>) => void;
}, getCtx: () => HandlerContext): void {

  bot.command("paid", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const { db } = getCtx();
    const text = ctx.message?.text ?? "";
    const parts = text.split(/\s+/);
    const amountStr = parts[1];

    if (!amountStr) {
      await ctx.reply("❌ Usage: `/paid <amount>`\nExample: `/paid 100`", {
        parse_mode: "Markdown",
      });
      return;
    }

    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) {
      await ctx.reply("❌ Please provide a valid positive amount.");
      return;
    }

    // Record payment
    const payment = await recordPayment(db, userId, amount);

    // Calculate updated balance
    const totalPaid = await getTotalPayments(db, userId);
    const totalInvoiced = await getTotalInvoiced(db, userId);
    const unpaidAmount = totalInvoiced - totalPaid;

    const lines = [
      `✅ *Payment Recorded*`,
      "",
      `• Payment ID: #${payment.id}`,
      `• Amount: \`$${amount.toFixed(2)}\``,
      "",
      `💰 *Updated Balance:*`,
      `• Total Invoiced: \`$${totalInvoiced.toFixed(2)}\``,
      `• Total Paid: \`$${totalPaid.toFixed(2)}\``,
      `• Remaining: \`$${Math.max(0, unpaidAmount).toFixed(2)}\``,
    ];

    if (unpaidAmount <= 0) {
      lines.push("", "🎉 All invoices are fully paid!");
    }

    await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
  });
}
