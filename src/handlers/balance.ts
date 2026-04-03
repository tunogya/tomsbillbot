import { Bot } from "grammy";
import { getBalance } from "../services/db";
import { formatAmount } from "../utils/time";
import type { BotContext } from "../env";

import { ensureGroupChat } from "../utils/bot";

export function registerBalanceHandler(
  bot: Bot<BotContext>
): void {
  bot.command("balance", async (ctx: BotContext) => {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;

    if (!userId || !chatId) {
      return;
    }

    if (!await ensureGroupChat(ctx, "balance")) return;

    try {
      const { db } = ctx;
      const balanceCents = await getBalance(db, userId, chatId);

      if (balanceCents === 0) {
        await ctx.reply("<b>Balance: $0.00</b>\n\nYou have no pending debts or credits in this group.", { parse_mode: "HTML" });
      } else if (balanceCents > 0) {
        await ctx.reply(`<b>Balance: $${formatAmount(balanceCents)}</b>\n\nYou have an unpaid debit balance. This means you owe money for past invoices that haven't been fully paid yet.`, { parse_mode: "HTML" });
      } else {
        // balanceCents < 0
        const creditCents = Math.abs(balanceCents);
        await ctx.reply(`<b>Balance: +$${formatAmount(creditCents)}</b>\n\nYou have a credit balance. This means you have overpaid. Future invoices will be offset by this credit.`, { parse_mode: "HTML" });
      }
    } catch (err) {
      console.error("Balance error:", err);
      await ctx.reply("Failed to retrieve balance.");
    }
  });
}
