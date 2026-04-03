/**
 * Invoice handler.
 * /invoice - generate an invoice from uninvoiced work sessions.
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
  getInvoiceAmountDue,
  parseMetadata,
  voidInvoice,
  recordPayment,
  getUninvoicedExpenses,
  INVOICE_STATUS,
} from "../services/db";
import { getCachedCustomer, getCachedUnitAmount } from "../utils/cache";
import { formatAmount, formatDuration, formatTimestampLocal, sumDurations } from "../utils/time";
import { escapeHtml } from "../utils/telegram";
import type { BotContext } from "../env";

import { ensureGroupChat } from "../utils/bot";

export function registerInvoiceHandler(bot: Bot<BotContext>): void {

  bot.command("invoice", async (ctx) => {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (!userId || !chatId) return;

    if (!await ensureGroupChat(ctx, "invoice")) return;

    const { db, kv } = ctx;

    // Parse tag if provided
    const match = ctx.match?.toString().trim();
    const tagMatch = match?.match(/#(\w+)/);
    const tag = tagMatch ? tagMatch[1] : null;

    // Get customer and unit price (cached) in parallel
    const [customer, unitAmount] = await Promise.all([
      getCachedCustomer(kv, db, userId),
      getCachedUnitAmount(kv, db, userId, chatId)
    ]);

    if (unitAmount <= 0) {
      await ctx.reply(
        "Tom's Bill Bot noticed your hourly rate for this chat is missing! Use <code>/setrate &lt;amount&gt;</code> first.",
        { parse_mode: "HTML" }
      );
      return;
    }

    // Get uninvoiced completed sessions in this chat
    const sessions = await getUninvoicedSessions(db, userId, chatId, tag);
    const expenses = await getUninvoicedExpenses(db, userId, chatId);

    if (sessions.length === 0 && expenses.length === 0) {
      const tagInfo = tag ? ` with project #${tag}` : "";
      await ctx.reply(`Tom's Bill Bot couldn't find any uninvoiced work sessions or expenses here${tagInfo}. All caught up!`);
      return;
    }

    // Create invoice with line items
    const invoice = await createInvoice(db, userId, chatId, sessions, unitAmount, expenses);

    // Get overall balance
    const summary = await getInvoiceSummary(db, userId, chatId);
    const unpaid = summary.total_invoiced - summary.total_paid;

    // Calculate total hours for display
    const totalMinutes = sumDurations(sessions);

    const tagTitle = tag ? ` [#${tag}]` : "";
    const lines = [
      `<b>Tom's Bill Bot presents Invoice #${invoice.id}${tagTitle}</b>`,
      `• Status: <code>${escapeHtml(invoice.status.toUpperCase())}</code>`,
      `• Sessions: ${sessions.length}`,
      `• Expenses: ${expenses.length}`,
      `• Total Hours: <code>${formatDuration(totalMinutes)}</code>`,
      `• Rate: <code>$${formatAmount(unitAmount)}/hr</code>`,
      `• Amount: <code>$${formatAmount(invoice.total)}</code>`,
      "",
      `<b>Summary:</b>`,
      `• Total Invoiced: <code>$${formatAmount(summary.total_invoiced)}</code>`,
      `• Total Paid: <code>$${formatAmount(summary.total_paid)}</code>`,
      "",
      `• Unpaid: <code>$${formatAmount(Math.max(0, unpaid))}</code>`
    ];

    if (customer?.payment_address) {
      lines.push("", `Pay to: <code>${escapeHtml(customer.payment_address)}</code>`);
    }

    const metadata = customer ? parseMetadata(customer.metadata) : {};
    if (metadata.remark) {
      lines.push(`Remark: ${escapeHtml(metadata.remark)}`);
    }

    await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
  });

  bot.command("invoices", async (ctx) => {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (!userId || !chatId) return;

    if (!await ensureGroupChat(ctx, "invoices")) return;

    const { db, kv } = ctx;
    const invoices = await getRecentInvoices(db, userId, chatId, 5);

    if (invoices.length === 0) {
      await ctx.reply("Tom's Bill Bot couldn't find any invoices for you in this chat yet.");
      return;
    }

    const customer = await getCachedCustomer(kv, db, userId);
    const metadata = customer ? parseMetadata(customer.metadata) : {};
    const tz = metadata.timezone;

    const lines = [
      "<b>Your Recent Invoices</b>",
      "",
      ...invoices.map((inv) => {
        const date = formatTimestampLocal(inv.created, tz).split(" ")[0]; // Just the YYYY-MM-DD
        const status = inv.status.toUpperCase();
        const statusEmoji = status === "PAID" ? "✅" : "⏳";
        return `• #${inv.id} (${date}) - <code>${formatAmount(inv.total)}</code> ${statusEmoji} <code>${escapeHtml(status)}</code>`;
      }),
      "",
      "<i>Showing up to 5 most recent records.</i>",
    ];

    // Find first unpaid invoice to show buttons for
    const unpaidInvoice = invoices.find(inv => inv.status === INVOICE_STATUS.OPEN || inv.status === INVOICE_STATUS.DRAFT);
    const options: any = { parse_mode: "HTML" };
    
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

    if (!await ensureGroupChat(ctx, "void")) return;

    const commandText = ctx.message?.text || "";
    const args = commandText.split(/\s+/);
    if (args.length < 2) {
      await ctx.reply("Usage: <code>/void &lt;id&gt;</code>", { parse_mode: "HTML" });
      return;
    }

    const invoiceId = parseInt(args[1], 10);
    if (isNaN(invoiceId)) {
      await ctx.reply("Please provide a valid numeric Invoice ID.");
      return;
    }

    const keyboard = new InlineKeyboard()
      .text("❌ Confirm Void", `confirm_void:${invoiceId}:${userId}`)
      .text("✅ Keep Invoice", `cancel_void:${userId}`);

    await ctx.reply(
      `<b>⚠️ VOID INVOICE #${invoiceId}?</b>\n\n` +
      `This will cancel the invoice and it will no longer count towards your balance.`,
      { parse_mode: "HTML", reply_markup: keyboard }
    );
  });

  bot.callbackQuery(/^confirm_void:(\d+):(\d+)$/, async (ctx) => {
    const invoiceId = parseInt(ctx.match[1], 10);
    const targetUserId = parseInt(ctx.match[2], 10);
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;

    if (!userId || !chatId) return;

    if (userId !== targetUserId) {
      await ctx.answerCallbackQuery({
        text: "This confirmation is for someone else! ⛔",
        show_alert: true
      });
      return;
    }

    const { db } = ctx;

    try {
      await voidInvoice(db, invoiceId, userId, chatId);
      await ctx.editMessageText(
        `✅ Invoice #${invoiceId} has been cancelled (voided). It will no longer appear in your balance.`
      );
      await ctx.answerCallbackQuery();
    } catch (error: any) {
      if (error.message === "Invoice not found or access denied") {
        await ctx.editMessageText(
          `❌ Tom's Bill Bot couldn't find Invoice #${invoiceId} for you in this chat. Make sure you are the author of the invoice.`
        );
        await ctx.answerCallbackQuery();
      } else {
        await ctx.editMessageText("❌ Error voiding invoice.");
        await ctx.answerCallbackQuery();
        console.error(error);
      }
    }
  });

  bot.callbackQuery(/^cancel_void:(\d+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    const targetUserId = parseInt(ctx.match[1], 10);
    if (userId !== targetUserId) {
      await ctx.answerCallbackQuery({
        text: "This confirmation is for someone else! ⛔",
        show_alert: true
      });
      return;
    }
    await ctx.editMessageText("Void operation cancelled. The invoice remains active.");
    await ctx.answerCallbackQuery();
  });

  bot.command("sessions", async (ctx) => {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (!userId || !chatId) return;

    if (!await ensureGroupChat(ctx, "sessions")) return;

    const { db, kv } = ctx;

    // Parse tag if provided
    const match = ctx.match?.toString().trim();
    const tagMatch = match?.match(/#(\w+)/);
    const tag = tagMatch ? tagMatch[1] : null;

    // Get uninvoiced completed sessions in this chat
    const sessions = await getUninvoicedSessions(db, userId, chatId, tag);
    const expenses = await getUninvoicedExpenses(db, userId, chatId);
    if (sessions.length === 0 && expenses.length === 0) {
      await ctx.reply("Tom's Bill Bot couldn't find any uninvoiced work sessions or expenses. You're all caught up!");
      return;
    }

    const customer = await getCachedCustomer(kv, db, userId);
    const metadata = customer ? parseMetadata(customer.metadata) : {};
    const tz = metadata.timezone;

    const totalMinutes = sumDurations(sessions);

    const tagTitle = tag ? ` [#${tag}]` : "";
    const lines = [
      `<b>Uninvoiced Items${tagTitle}</b>`,
      "",
      ...sessions.map((s, i) => {
        const date = formatTimestampLocal(s.start_time, tz).split(" ")[0]; // Just the YYYY-MM-DD
        const tagInfo = s.tag ? ` [${s.tag}]` : "";
        return `${i + 1}. Session: ${date} - <code>${formatDuration(s.duration_minutes ?? 0)}h</code>${tagInfo}`;
      }),
      ...expenses.map((e, i) => {
        return `${sessions.length + i + 1}. Expense: <code>$${formatAmount(e.amount)}</code> - ${e.description}`;
      }),
      "",
      `<b>Total Unbilled Hours:</b> <code>${formatDuration(totalMinutes)} hours</code>`,
      "",
      "<i>Ready to bill? Use /invoice</i>"
    ];

    await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
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
      const amountDue = await getInvoiceAmountDue(db, invoiceId, userId, chatId);

      if (amountDue <= 0) {
        await ctx.answerCallbackQuery({ text: "Invoice is already paid or voided.", show_alert: true });
        return;
      }

      await recordPayment(db, userId, chatId, amountDue);
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
