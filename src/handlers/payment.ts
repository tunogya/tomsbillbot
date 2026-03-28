/**
 * Payment handler.
 * /paid <amount> — record a payment.
 *
 * Flow (Stripe-inspired):
 * 1. Parse dollar amount → convert to cents
 * 2. Auto-link to latest open Invoice
 * 3. Update Invoice status (open → paid when fully paid)
 * 4. Create BalanceTransaction
 * 5. Display payment receipt with balance
 */

import type { Context } from "grammy";
import { recordPayment, getInvoiceSummary } from "../services/db";
import { formatAmount } from "../utils/time";
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

    const dollars = parseFloat(amountStr);
    if (isNaN(dollars) || dollars <= 0) {
      await ctx.reply("Oops! Tom's Bill Bot needs a valid positive amount.");
      return;
    }

    // Convert dollars to cents
    const amountCents = Math.round(dollars * 100);

    // Record payment (auto-links to latest open invoice)
    const { payment, invoice } = await recordPayment(db, userId, chatId, amountCents);

    // Get updated balance
    const summary = await getInvoiceSummary(db, userId, chatId);
    const unpaid = summary.total_invoiced - summary.total_paid;

    const lines = [
      `*Payment Recorded by Tom's Bill Bot 💰*`,
      "",
      `• Payment ID: #${payment.id}`,
      `• Amount: \`$${formatAmount(amountCents)}\``,
      `• Status: \`${payment.status.toUpperCase()}\``,
    ];

    if (invoice) {
      lines.push(`• Linked to Invoice #${invoice.id} (${invoice.status.toUpperCase()})`);
    }

    lines.push(
      "",
      `*Updated Balance:*`,
      `• Total Invoiced: \`$${formatAmount(summary.total_invoiced)}\``,
      `• Total Paid: \`$${formatAmount(summary.total_paid)}\``,
      `• Remaining: \`$${formatAmount(Math.max(0, unpaid))}\``
    );

    if (unpaid <= 0) {
      lines.push("", "All invoices are fully paid! Tom's Bill Bot is happy! 🎉");
    }

    await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
  });
}
