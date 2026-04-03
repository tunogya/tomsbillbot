/**
 * Expense handler.
 * /expense <amount> <description> - log a non-time expense.
 */

import { Bot } from "grammy";
import { addExpense, upsertCustomer } from "../services/db";
import { formatAmount } from "../utils/time";
import { escapeHtml } from "../utils/telegram";
import { ensureGroupChat } from "../utils/bot";
import type { BotContext } from "../env";

export function registerExpenseHandler(bot: Bot<BotContext>): void {
  bot.command("expense", async (ctx) => {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (!userId || !chatId) return;

    if (!await ensureGroupChat(ctx, "expense")) return;

    const { db } = ctx;
    const match = ctx.match?.toString().trim();

    if (!match) {
      await ctx.reply(
        "Tom's Bill Bot needs some details! Usage: <code>/expense &lt;amount&gt; &lt;description&gt;</code>\nExample: <code>/expense 50 domain renewal</code>",
        { parse_mode: "HTML" }
      );
      return;
    }

    const parts = match.split(/\s+/);
    const amountStr = parts[0];
    const description = parts.slice(1).join(" ").trim();

    const amountDollars = parseFloat(amountStr);
    if (isNaN(amountDollars) || amountDollars <= 0) {
      await ctx.reply("Oops! Please provide a valid positive number for the amount.");
      return;
    }

    if (!description) {
      await ctx.reply("Tom's Bill Bot needs a description for the expense! What was it for?");
      return;
    }

    const amountCents = Math.round(amountDollars * 100);

    try {
      await upsertCustomer(db, userId, ctx.from?.first_name);
      await addExpense(db, userId, chatId, amountCents, description);
      await ctx.reply(
        "<b>Expense logged! 💸</b>\n\n" +
        `Amount: <code>$${escapeHtml(formatAmount(amountCents))}</code>\n` +
        `Description: <code>${escapeHtml(description)}</code>`,
        { parse_mode: "HTML" }
      );
    } catch (err) {
      console.error("Expense log failed:", err);
      throw err;
    }
  });
}
