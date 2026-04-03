/**
 * Payment handler.
 * /paid <amount> - record a payment.
 *
 * Flow (Stripe-inspired):
 * 1. Parse dollar amount → convert to cents
 * 2. Auto-link to latest open Invoice
 * 3. Update Invoice status (open → paid when fully paid)
 * 4. Create BalanceTransaction
 * 5. Display payment receipt with balance
 */

import { Bot, InlineKeyboard } from "grammy";
import { recordPayment, getInvoiceSummary, PAYMENT_STATUS, INVOICE_STATUS } from "../services/db";
import { formatAmount } from "../utils/time";
import type { BotContext } from "../env";

import { ensureGroupChat } from "../utils/bot";

export function registerPaymentHandler(bot: Bot<BotContext>): void {

  bot.command("paid", async (ctx) => {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (!userId || !chatId) return;

    if (!await ensureGroupChat(ctx, "paid")) return;

    const { db } = ctx;
    const text = ctx.message?.text ?? "";
    const parts = text.split(/\s+/);
    const amountStr = parts[1];

    if (!amountStr) {
      await ctx.reply("Hold your horses! Usage: <code>/paid &lt;amount&gt;</code>\nExample: <code>/paid 100</code>", {
        parse_mode: "HTML",
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

    const keyboard = new InlineKeyboard()
      .text(`💰 Confirm Payment: $${formatAmount(amountCents)}`, `confirm_paid:${amountCents}:${userId}`)
      .text("❌ Cancel", `cancel_paid:${userId}`);

    await ctx.reply(
      `<b>⚠️ RECORD PAYMENT?</b>\n\n` +
      `You are about to record a payment of <code>$${formatAmount(amountCents)}</code> against your balance in this group.`,
      { parse_mode: "HTML", reply_markup: keyboard }
    );
  });

  bot.callbackQuery(/^confirm_paid:(\d+):(\d+)$/, async (ctx) => {
    const amountCents = parseInt(ctx.match[1], 10);
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
      // Record payment (auto-links to latest open invoice)
      const { payment, invoice } = await recordPayment(db, userId, chatId, amountCents);

      // Get updated balance
      const summary = await getInvoiceSummary(db, userId, chatId);
      const unpaid = summary.total_invoiced - summary.total_paid;

      const lines = [
        "✅ <b>Payment Recorded by Tom's Bill Bot 💰</b>",
        "",
        `• Payment ID: #${payment.id}`,
        `• Amount: <code>$${formatAmount(amountCents)}</code>`,
        `• Status: <code>${payment.status.toUpperCase()}</code>`,
      ];

      if (invoice) {
        lines.push(`• Linked to Invoice #${invoice.id} (<code>${invoice.status.toUpperCase()}</code>)`);
      }

      lines.push(
        "",
        "<b>Updated Balance:</b>",
        `• Total Invoiced: <code>$${formatAmount(summary.total_invoiced)}</code>`,
        `• Total Paid: <code>$${formatAmount(summary.total_paid)}</code>`,
        `• Remaining: <code>$${formatAmount(Math.max(0, unpaid))}</code>`
      );

      if (unpaid <= 0) {
        lines.push("", "All invoices are fully paid! Tom's Bill Bot is happy!");
      }

      await ctx.editMessageText(lines.join("\n"), { parse_mode: "HTML" });
      await ctx.answerCallbackQuery();
    } catch (err) {
      console.error("Payment failed:", err);
      await ctx.editMessageText("❌ <b>Yikes!</b> Tom's Bill Bot encountered an error while recording payment.", { parse_mode: "HTML" });
      await ctx.answerCallbackQuery();
    }
  });

  bot.callbackQuery(/^cancel_paid:(\d+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    const targetUserId = parseInt(ctx.match[1], 10);
    if (userId !== targetUserId) {
      await ctx.answerCallbackQuery({
        text: "This confirmation is for someone else! ⛔",
        show_alert: true
      });
      return;
    }
    await ctx.editMessageText("Payment cancelled. No transaction was recorded.");
    await ctx.answerCallbackQuery();
  });


  bot.command("settle", async (ctx) => {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (!userId || !chatId) return;

    if (!await ensureGroupChat(ctx, "settle")) return;

    const { db } = ctx;

    // Get updated balance
    const summary = await getInvoiceSummary(db, userId, chatId);
    const unpaid = summary.total_invoiced - summary.total_paid;

    if (unpaid <= 0) {
      await ctx.reply("You have no outstanding balance to settle. All invoices are fully paid!", { parse_mode: "HTML" });
      return;
    }

    const keyboard = new InlineKeyboard()
      .text(`✅ Settle Entire Balance ($${formatAmount(unpaid)})`, `confirm_settle:${userId}`)
      .text("❌ Cancel", `cancel_settle:${userId}`);

    await ctx.reply(
      "<b>⚠️ SETTLE ENTIRE BALANCE?</b>\n\n" +
      `This will record a payment for your entire remaining balance of <code>$${formatAmount(unpaid)}</code>.`,
      { parse_mode: "HTML", reply_markup: keyboard }
    );
  });

  bot.callbackQuery(/^confirm_settle:(\d+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    const targetUserId = parseInt(ctx.match[1], 10);
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
      // Get updated balance
      const summary = await getInvoiceSummary(db, userId, chatId);
      const unpaid = summary.total_invoiced - summary.total_paid;

      if (unpaid <= 0) {
        await ctx.editMessageText("No outstanding balance left to settle.");
        await ctx.answerCallbackQuery();
        return;
      }

      // Record payment (auto-links to latest open invoice)
      const { payment, invoice } = await recordPayment(db, userId, chatId, unpaid);

      const lines = [
        "✅ <b>Balance Settled! 💰</b>",
        "",
        `• Payment ID: #${payment.id}`,
        `• Amount: <code>$${formatAmount(unpaid)}</code>`,
        `• Status: <code>${payment.status.toUpperCase()}</code>`,
      ];

      if (invoice) {
        lines.push(`• Linked to Invoice #${invoice.id} (<code>${invoice.status.toUpperCase()}</code>)`);
      }

      lines.push(
        "",
        "All invoices are now fully paid! Tom's Bill Bot is happy!"
      );

      await ctx.editMessageText(lines.join("\n"), { parse_mode: "HTML" });
      await ctx.answerCallbackQuery();
    } catch (err) {
      console.error("Settle failed:", err);
      await ctx.editMessageText("❌ <b>Yikes!</b> Tom's Bill Bot encountered an error while settling balance.", { parse_mode: "HTML" });
      await ctx.answerCallbackQuery();
    }
  });

  bot.callbackQuery(/^cancel_settle:(\d+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    const targetUserId = parseInt(ctx.match[1], 10);
    if (userId !== targetUserId) {
      await ctx.answerCallbackQuery({
        text: "This confirmation is for someone else! ⛔",
        show_alert: true
      });
      return;
    }
    await ctx.editMessageText("Settle operation cancelled. No payment was recorded.");
    await ctx.answerCallbackQuery();
  });
}
