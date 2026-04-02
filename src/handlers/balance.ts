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
        await ctx.reply("*Balance: $0.00*\n\nYou have no pending debts or credits in this group.", { parse_mode: "Markdown" });
      } else if (balanceCents > 0) {
        await ctx.reply(`*Balance: $${formatAmount(balanceCents)}*\n\nYou have an unpaid debit balance. This means you owe money for past invoices that haven't been fully paid yet.`, { parse_mode: "Markdown" });
      } else {
        // balanceCents < 0
        const creditCents = Math.abs(balanceCents);
        await ctx.reply(`*Balance: +$${formatAmount(creditCents)}*\n\nYou have a credit balance. This means you have overpaid. Future invoices will be offset by this credit.`, { parse_mode: "Markdown" });
      }
    } catch (err) {
      console.error("Balance error:", err);
      await ctx.reply("Failed to retrieve balance.");
    }
  });
}
