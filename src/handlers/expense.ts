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
      await ctx.reply(ctx.t("expense_prompt"), { parse_mode: "HTML" });
      return;
    }

    const parts = match.split(/\s+/);
    const amountStr = parts[0];
    const description = parts.slice(1).join(" ").trim();

    const amountDollars = parseFloat(amountStr);
    if (isNaN(amountDollars) || amountDollars <= 0) {
      await ctx.reply(ctx.t("settings_invalid_number"));
      return;
    }

    if (!description) {
      await ctx.reply(ctx.t("expense_no_desc"));
      return;
    }

    const amountCents = Math.round(amountDollars * 100);

    try {
      await upsertCustomer(db, userId, ctx.from?.first_name);
      await addExpense(db, userId, chatId, amountCents, description);
      await ctx.reply(
        ctx.t("expense_logged", {
          amount: formatAmount(amountCents),
          description: escapeHtml(description),
        }),
        { parse_mode: "HTML" }
      );
    } catch (err) {
      console.error("Expense log failed:", err);
      throw err;
    }
  });
}
