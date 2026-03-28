/**
 * User configuration handlers (DM commands).
 * /setrate <hourly_rate>
 * /setaddress <USDT_address>
 */

import type { Context } from "grammy";
import { upsertUser, setHourlyRate, setPaymentAddress } from "../services/db";
import type { HandlerContext } from "../env";

export function registerConfigHandlers(bot: {
  command: (cmd: string, handler: (ctx: Context) => Promise<void>) => void;
}, getCtx: () => HandlerContext): void {

  // /setrate <amount>
  bot.command("setrate", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const { db } = getCtx();
    const text = ctx.message?.text ?? "";
    const parts = text.split(/\s+/);
    const rateStr = parts[1];

    if (!rateStr) {
      await ctx.reply("❌ Usage: `/setrate <amount>`\nExample: `/setrate 50`", {
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

  // /setaddress <address>
  bot.command("setaddress", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const { db } = getCtx();
    const text = ctx.message?.text ?? "";
    const parts = text.split(/\s+/);
    const address = parts[1];

    if (!address) {
      await ctx.reply(
        "❌ Usage: `/setaddress <USDT_address>`\nExample: `/setaddress TXyz...`",
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
