/**
 * User configuration handlers (DM commands).
 * /set_rate <hourly_rate>
 * /set_address <USDT_address>
 */

import type { Context } from "grammy";
import { upsertUser, setHourlyRate, setPaymentAddress } from "../services/db";
import type { HandlerContext } from "../env";

export function registerConfigHandlers(bot: {
  command: (cmd: string, handler: (ctx: Context) => Promise<void>) => void;
}, getCtx: () => HandlerContext): void {

  // /set_rate <amount>
  bot.command("set_rate", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const { db } = getCtx();
    const text = ctx.message?.text ?? "";
    const parts = text.split(/\s+/);
    const rateStr = parts[1];

    if (!rateStr) {
      await ctx.reply("❌ Usage: `/set_rate <amount>`\nExample: `/set_rate 50`", {
        parse_mode: "Markdown",
      });
      return;
    }

    const rate = parseFloat(rateStr);
    if (isNaN(rate) || rate < 0) {
      await ctx.reply("❌ Please provide a valid non-negative number.");
      return;
    }

    await upsertUser(db, userId);
    await setHourlyRate(db, userId, rate);

    await ctx.reply(`✅ Hourly rate set to \`$${rate}/hr\``, {
      parse_mode: "Markdown",
    });
  });

  // /set_address <address>
  bot.command("set_address", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const { db } = getCtx();
    const text = ctx.message?.text ?? "";
    const parts = text.split(/\s+/);
    const address = parts[1];

    if (!address) {
      await ctx.reply(
        "❌ Usage: `/set_address <USDT_address>`\nExample: `/set_address TXyz...`",
        { parse_mode: "Markdown" }
      );
      return;
    }

    await upsertUser(db, userId);
    await setPaymentAddress(db, userId, address);

    await ctx.reply(`✅ Payment address set to \`${address}\``, {
      parse_mode: "Markdown",
    });
  });
}
