import { Bot, Context } from "grammy";
import { getBalance } from "../services/db";
import { formatAmount } from "../utils/time";
import type { HandlerContext } from "../env";

export function registerBalanceHandler(
  bot: Bot,
  getCtx: () => HandlerContext
): void {
  bot.command("balance", async (ctx: Context) => {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;

    if (!userId || !chatId) {
      return;
    }

    if (ctx.chat?.type === "private") {
      await ctx.reply("Tom's Bill Bot can only check balances in group chats.");
      return;
    }

    try {
      const { db } = getCtx();
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
