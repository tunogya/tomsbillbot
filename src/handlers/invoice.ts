/**
 * Invoice handler.
 * /newinvoice — generate an invoice from uninvoiced work sessions.
 *
 * Flow (Stripe-inspired):
 * 1. Get uninvoiced completed sessions
 * 2. Get unit price for this customer in this chat
 * 3. Create Invoice (status='open') with InvoiceLineItems
 * 4. Link sessions to invoice
 * 5. Create BalanceTransaction
 * 6. Display invoice with balance summary
 */

import type { Context } from "grammy";
import {
  getUninvoicedSessions,
  createInvoice,
  getInvoiceSummary,
  getRecentInvoices,
  parseMetadata,
  voidInvoice,
} from "../services/db";
import { getCachedCustomer, getCachedUnitAmount } from "../utils/cache";
import { formatAmount, formatDuration, formatTimestamp } from "../utils/time";
import type { HandlerContext } from "../env";

export function registerInvoiceHandler(bot: {
  command: (cmd: string, handler: (ctx: Context) => Promise<void>) => void;
}, getCtx: () => HandlerContext): void {

  bot.command("newinvoice", async (ctx) => {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (!userId || !chatId) return;

    if (ctx.chat.type === "private") {
      await ctx.reply("Hey there! Tom's Bill Bot can only generate invoices in group chats.", {
        parse_mode: "Markdown",
      });
      return;
    }

    const { db, kv } = getCtx();

    // Get customer (cached)
    const customer = await getCachedCustomer(kv, db, userId);

    // Get unit price (cached, cents/hour) for this chat
    const unitAmount = await getCachedUnitAmount(kv, db, userId, chatId);

    if (unitAmount <= 0) {
      await ctx.reply(
        "Tom's Bill Bot noticed your hourly rate for this chat is missing! Use `/setrate <amount>` first.",
        { parse_mode: "Markdown" }
      );
      return;
    }

    // Get uninvoiced completed sessions in this chat
    const sessions = await getUninvoicedSessions(db, userId, chatId);
    if (sessions.length === 0) {
      await ctx.reply("Tom's Bill Bot couldn't find any uninvoiced work sessions here. All caught up!");
      return;
    }

    // Create invoice with line items
    const invoice = await createInvoice(db, userId, chatId, sessions, unitAmount);

    // Get overall balance
    const summary = await getInvoiceSummary(db, userId, chatId);
    const unpaid = summary.total_invoiced - summary.total_paid;

    // Calculate total hours for display
    const totalMinutes = sessions.reduce((sum, s) => sum + (s.duration_minutes ?? 0), 0);

    const lines = [
      `*Tom's Bill Bot presents Invoice #${invoice.id}*`,
      `• Status: \`${invoice.status.toUpperCase()}\``,
      `• Sessions: ${sessions.length}`,
      `• Total Hours: \`${formatDuration(totalMinutes)}\``,
      `• Rate: \`$${formatAmount(unitAmount)}/hr\``,
      `• Amount: \`$${formatAmount(invoice.total)}\``,
      "",
      `*Summary:*`,
      `• Total Invoiced: \`$${formatAmount(summary.total_invoiced)}\``,
      `• Total Paid: \`$${formatAmount(summary.total_paid)}\``,
      "",
      `• Unpaid: \`$${formatAmount(Math.max(0, unpaid))}\``
    ];

    if (customer?.payment_address) {
      lines.push("", `Pay to: \`${customer.payment_address}\``);
    }

    const metadata = customer ? parseMetadata(customer.metadata) : {};
    if (metadata.remark) {
      lines.push(`Remark: ${metadata.remark}`);
    }

    await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
  });

  bot.command("invoices", async (ctx) => {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (!userId || !chatId) return;

    if (ctx.chat.type === "private") {
      await ctx.reply("Hey there! Tom's Bill Bot can only show group invoices here.", {
        parse_mode: "Markdown",
      });
      return;
    }

    const { db } = getCtx();
    const invoices = await getRecentInvoices(db, userId, chatId, 5);

    if (invoices.length === 0) {
      await ctx.reply("Tom's Bill Bot couldn't find any invoices for you in this chat yet.");
      return;
    }

    const lines = [
      "*Your Recent Invoices*",
      "",
      ...invoices.map((inv) => {
        const date = formatTimestamp(inv.created).split(" ")[0]; // Just the YYYY-MM-DD
        const status = inv.status.toUpperCase();
        const statusEmoji = status === "PAID" ? "✅" : "⏳";
        return `• #${inv.id} (${date}) — \`$${formatAmount(inv.total)}\` ${statusEmoji} \`${status}\``;
      }),
      "",
      "_Showing up to 5 most recent records._",
    ];

    await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
  });

  bot.command("deleteinvoice", async (ctx) => {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (!userId || !chatId) return;

    if (ctx.chat.type === "private") {
      await ctx.reply("Tom's Bill Bot can only delete group invoices here.");
      return;
    }

    const commandText = ctx.message?.text || "";
    const args = commandText.split(/\s+/);
    if (args.length < 2) {
      await ctx.reply("Usage: `/deleteinvoice <id>`", { parse_mode: "Markdown" });
      return;
    }

    const invoiceId = parseInt(args[1], 10);
    if (isNaN(invoiceId)) {
      await ctx.reply("Please provide a valid numeric Invoice ID.");
      return;
    }

    const { db } = getCtx();

    try {
      await voidInvoice(db, invoiceId, userId, chatId);
      await ctx.reply(
        `Invoice #${invoiceId} has been cancelled (voided). It will no longer appear in your balance.`
      );
    } catch (error: any) {
      if (error.message === "Invoice not found or access denied") {
        await ctx.reply(
          `Tom's Bill Bot couldn't find Invoice #${invoiceId} for you in this chat. Make sure you are the author of the invoice.`
        );
      } else {
        throw error; // Let bot.catch handle it
      }
    }
  });
}
