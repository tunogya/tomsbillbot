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
    const chatId = ctx.chat?.id;
    if (!userId || !chatId) return;

    if (ctx.chat.type === "private") {
      await ctx.reply("Hey there! 🤖 Tom's Bill Bot needs to be in a group chat to process the `/paid` command.", {
        parse_mode: "Markdown",
      });
      return;
    }

    const { db } = getCtx();
    const text = ctx.message?.text ?? "";
    const parts = text.split(/\s+/);
    const amountStr = parts[1];

    if (!amountStr) {
      await ctx.reply("Hold your horses! 🐴 Usage: `/paid <amount>`\nExample: `/paid 100`", {
        parse_mode: "Markdown",
      });
      return;
    }

    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) {
      await ctx.reply("Oops! Tom's Bill Bot needs a valid positive amount.");
      return;
    }

    // Record payment in this chat
    const payment = await recordPayment(db, userId, chatId, amount);

    // Calculate updated balance in this chat
    const totalPaid = await getTotalPayments(db, userId, chatId);
    const totalInvoiced = await getTotalInvoiced(db, userId, chatId);
    const unpaidAmount = totalInvoiced - totalPaid;

    const lines = [
      `*Payment Recorded by Tom's Bill Bot 💰*`,
      "",
      `• Payment ID: #${payment.id}`,
      `• Amount: \`$${amount.toFixed(2)}\``,
      "",
      `*Updated Balance:*`,
      `• Total Invoiced: \`$${totalInvoiced.toFixed(2)}\``,
      `• Total Paid: \`$${totalPaid.toFixed(2)}\``,
      `• Remaining: \`$${Math.max(0, unpaidAmount).toFixed(2)}\``,
    ];

    if (unpaidAmount <= 0) {
      lines.push("", "All invoices are fully paid! Tom's Bill Bot is happy! 🎉");
    }

    await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
  });
}
