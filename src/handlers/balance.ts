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
        await ctx.reply(ctx.t("balance_settled"), { parse_mode: "HTML" });
      } else if (balanceCents > 0) {
        await ctx.reply(ctx.t("balance_owe", { amount: formatAmount(balanceCents) }), { parse_mode: "HTML" });
      } else {
        // balanceCents < 0
        const creditCents = Math.abs(balanceCents);
        await ctx.reply(ctx.t("balance_credit", { amount: formatAmount(creditCents) }), { parse_mode: "HTML" });
      }
    } catch (err) {
      console.error("Balance error:", err);
      await ctx.reply(ctx.t("error_generic"));
    }
  });
}
