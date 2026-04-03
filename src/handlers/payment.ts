/**
 * Payment handler.
 * /paid <amount> - record a payment.
 */

import { Bot, InlineKeyboard } from "grammy";
import { recordPayment, getInvoiceSummary } from "../services/db";
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
      await ctx.reply("Usage: <code>/paid &lt;amount&gt;</code>\nExample: <code>/paid 100</code>", {
        parse_mode: "HTML",
      });
      return;
    }

    const dollars = parseFloat(amountStr);
    if (isNaN(dollars) || dollars <= 0) {
      await ctx.reply(ctx.t("settings_invalid_number"));
      return;
    }

    const amountCents = Math.round(dollars * 100);

    const keyboard = new InlineKeyboard()
      .text(`💰 Confirm: $${formatAmount(amountCents)}`, `confirm_paid:${amountCents}:${userId}`)
      .text(ctx.t("cancel"), `cancel_paid:${userId}`);

    await ctx.reply(
      `<b>⚠️ RECORD PAYMENT?</b>\n\n` +
      `You are about to record a payment of <code>$${formatAmount(amountCents)}</code>.`,
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
      await ctx.answerCallbackQuery({ text: ctx.t("unauthorized"), show_alert: true });
      return;
    }

    const { db } = ctx;

    try {
      const { payment, invoice } = await recordPayment(db, userId, chatId, amountCents);
      const summary = await getInvoiceSummary(db, userId, chatId);
      const unpaid = summary.total_invoiced - summary.total_paid;

      const lines = [
        "✅ <b>Payment Recorded 💰</b>",
        "",
        `• ID: #${payment.id}`,
        `• Amount: <code>$${formatAmount(amountCents)}</code>`,
        `• Status: <code>${payment.status.toUpperCase()}</code>`,
      ];

      if (invoice) {
        lines.push(`• Linked to Invoice #${invoice.id} (<code>${invoice.status.toUpperCase()}</code>)`);
      }

      lines.push(
        "",
        "<b>Updated Balance:</b>",
        `• Invoiced: <code>$${formatAmount(summary.total_invoiced)}</code>`,
        `• Paid: <code>$${formatAmount(summary.total_paid)}</code>`,
        `• Remaining: <code>$${formatAmount(Math.max(0, unpaid))}</code>`
      );

      await ctx.editMessageText(lines.join("\n"), { parse_mode: "HTML" });
      await ctx.answerCallbackQuery();
    } catch (err) {
      console.error("Payment failed:", err);
      await ctx.editMessageText(ctx.t("error_generic"), { parse_mode: "HTML" });
      await ctx.answerCallbackQuery();
    }
  });

  bot.callbackQuery(/^cancel_paid:(\d+)$/, async (ctx) => {
    await ctx.editMessageText("Payment cancelled.");
    await ctx.answerCallbackQuery();
  });


  bot.command("settle", async (ctx) => {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (!userId || !chatId) return;
    if (!await ensureGroupChat(ctx, "settle")) return;

    const { db } = ctx;
    const summary = await getInvoiceSummary(db, userId, chatId);
    const unpaid = summary.total_invoiced - summary.total_paid;

    if (unpaid <= 0) {
      await ctx.reply("No outstanding balance to settle.");
      return;
    }

    const keyboard = new InlineKeyboard()
      .text(`✅ Settle Entire Balance ($${formatAmount(unpaid)})`, `confirm_settle:${userId}`)
      .text(ctx.t("cancel"), `cancel_settle:${userId}`);

    await ctx.reply(
      "<b>⚠️ SETTLE ENTIRE BALANCE?</b>\n\n" +
      `This will record a payment for <code>$${formatAmount(unpaid)}</code>.`,
      { parse_mode: "HTML", reply_markup: keyboard }
    );
  });

  bot.callbackQuery(/^confirm_settle:(\d+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    const targetUserId = parseInt(ctx.match[1], 10);
    const chatId = ctx.chat?.id;
    if (!userId || !chatId || userId !== targetUserId) {
      await ctx.answerCallbackQuery({ text: ctx.t("unauthorized"), show_alert: true });
      return;
    }

    const { db } = ctx;
    try {
      const summary = await getInvoiceSummary(db, userId, chatId);
      const unpaid = summary.total_invoiced - summary.total_paid;

      if (unpaid <= 0) {
        await ctx.editMessageText("No outstanding balance left to settle.");
        await ctx.answerCallbackQuery();
        return;
      }

      const { payment } = await recordPayment(db, userId, chatId, unpaid);
      await ctx.editMessageText(`✅ <b>Balance Settled! 💰</b>\n\nID: #${payment.id}\nAmount: <code>$${formatAmount(unpaid)}</code>`, { parse_mode: "HTML" });
      await ctx.answerCallbackQuery();
    } catch (err) {
      console.error("Settle failed:", err);
      await ctx.editMessageText(ctx.t("error_generic"), { parse_mode: "HTML" });
      await ctx.answerCallbackQuery();
    }
  });

  bot.callbackQuery(/^cancel_settle:(\d+)$/, async (ctx) => {
    await ctx.editMessageText("Settle operation cancelled.");
    await ctx.answerCallbackQuery();
  });
}
