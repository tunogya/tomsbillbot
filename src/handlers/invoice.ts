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

import { Bot, InlineKeyboard } from "grammy";
import {
  getUninvoicedSessions,
  createInvoice,
  getInvoiceSummary,
  getRecentInvoices,
  parseMetadata,
  voidInvoice,
  recordPayment,
} from "../services/db";
import { getCachedCustomer, getCachedUnitAmount } from "../utils/cache";
import { formatAmount, formatDuration, formatTimestamp } from "../utils/time";
import type { BotContext } from "../env";

export function registerInvoiceHandler(bot: Bot<BotContext>): void {

  bot.command("invoice", async (ctx) => {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (!userId || !chatId) return;

    if (ctx.chat.type === "private") {
      await ctx.reply("Hey there! Tom's Bill Bot can only generate invoices in group chats.", {
        parse_mode: "Markdown",
      });
      return;
    }

    const { db, kv } = ctx;

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

    const { db } = ctx;
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
        return `• #${inv.id} (${date}) — \`${formatAmount(inv.total)}\` ${statusEmoji} \`${status}\``;
      }),
      "",
      "_Showing up to 5 most recent records._",
    ];

    // Find first unpaid invoice to show buttons for
    const unpaidInvoice = invoices.find(inv => inv.status === 'open' || inv.status === 'draft');
    const options: any = { parse_mode: "Markdown" };
    
    if (unpaidInvoice) {
      options.reply_markup = new InlineKeyboard()
        .text("❌ Void #" + unpaidInvoice.id, "void_" + unpaidInvoice.id)
        .text("💳 Pay #" + unpaidInvoice.id, "pay_" + unpaidInvoice.id);
    }

    await ctx.reply(lines.join("\n"), options);
  });

  bot.command("void", async (ctx) => {
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
      await ctx.reply("Usage: `/void <id>`", { parse_mode: "Markdown" });
      return;
    }

    const invoiceId = parseInt(args[1], 10);
    if (isNaN(invoiceId)) {
      await ctx.reply("Please provide a valid numeric Invoice ID.");
      return;
    }

    const { db } = ctx;

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

  bot.command("sessions", async (ctx) => {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (!userId || !chatId) return;

    if (ctx.chat.type === "private") {
      await ctx.reply("Hey there! Tom's Bill Bot can only show sessions in group chats.", {
        parse_mode: "Markdown",
      });
      return;
    }

    const { db } = ctx;

    // Get uninvoiced completed sessions in this chat
    const sessions = await getUninvoicedSessions(db, userId, chatId);
    if (sessions.length === 0) {
      await ctx.reply("Tom's Bill Bot couldn't find any uninvoiced work sessions. You're all caught up!");
      return;
    }

    const totalMinutes = sessions.reduce((sum, s) => sum + (s.duration_minutes ?? 0), 0);

    const lines = [
      `*Uninvoiced Work Sessions*`,
      "",
      ...sessions.map((s, i) => {
        const date = formatTimestamp(s.start_time).split(" ")[0]; // Just the YYYY-MM-DD
        return `${i + 1}. ${date} — \`${formatDuration(s.duration_minutes ?? 0)} hours\``;
      }),
      "",
      `*Total Unbilled:* \`${formatDuration(totalMinutes)} hours\``,
      "",
      "_Ready to bill? Use /invoice_"
    ];

    await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
  });

  bot.callbackQuery(/^void_(\d+)$/, async (ctx) => {
    const invoiceIdStr = ctx.match[1];
    const invoiceId = parseInt(invoiceIdStr, 10);
    
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (!userId || !chatId) return;

    const { db } = ctx;

    try {
      await voidInvoice(db, invoiceId, userId, chatId);
      await ctx.answerCallbackQuery({ text: "Invoice voided successfully!", show_alert: true });
      
      // Optionally update the message to remove the button
      if (ctx.callbackQuery.message) {
        await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() });
      }
    } catch (error: any) {
      if (error.message === "Invoice not found or access denied") {
        await ctx.answerCallbackQuery({ text: "Cannot void this invoice.", show_alert: true });
      } else {
        await ctx.answerCallbackQuery({ text: "Error voiding invoice." });
        console.error(error);
      }
    }
  });


  bot.callbackQuery(/^pay_(\d+)$/, async (ctx) => {
    const invoiceIdStr = ctx.match[1];
    const invoiceId = parseInt(invoiceIdStr, 10);
    
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (!userId || !chatId) return;

    const { db } = ctx;

    try {
      // Find the invoice to get the amount due
      const result = await db.prepare("SELECT amount_due FROM invoices WHERE id = ? AND customer_id = ? AND chat_id = ?")
        .bind(invoiceId, userId, chatId).first<{ amount_due: number }>();
        
      if (!result) {
        await ctx.answerCallbackQuery({ text: "Invoice not found.", show_alert: true });
        return;
      }
      
      if (result.amount_due <= 0) {
        await ctx.answerCallbackQuery({ text: "Invoice is already paid or voided.", show_alert: true });
        return;
      }

      await recordPayment(db, userId, chatId, result.amount_due);
      await ctx.answerCallbackQuery({ text: "Payment recorded successfully!", show_alert: true });
      
      if (ctx.callbackQuery.message) {
        await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() });
        // Can optionally append text to the message, but hiding the keyboard is enough.
      }
    } catch (error: any) {
      await ctx.answerCallbackQuery({ text: "Error recording payment." });
      console.error(error);
    }
  });

}
