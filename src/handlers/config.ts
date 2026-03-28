/**
 * User configuration handlers (DM commands).
 * /setrate <hourly_rate>
 * /setaddress <USDT_address>
 */

import type { Context } from "grammy";
import { upsertUser, setHourlyRate, setUserChatRate, setPaymentAddress, setUserRemark } from "../services/db";
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
      await ctx.reply("Hold your horses! 🐴 Usage: `/setrate <amount>`\nExample: `/setrate 50`", {
        parse_mode: "Markdown",
      });
      return;
    }

    const rate = parseFloat(rateStr);
    if (isNaN(rate) || rate < 0) {
      await ctx.reply("Oops! Please provide a valid non-negative number for Tom's Bill Bot.");
      return;
    }

    const chatId = ctx.chat?.id;
    if (!chatId) return;

    await upsertUser(db, userId);

    if (ctx.chat.type === "private") {
      await setHourlyRate(db, userId, rate);
      await ctx.reply(`Got it! ✍️ *Default* hourly rate set to \`$${rate}/hr\``, {
        parse_mode: "Markdown",
      });
    } else {
      await setUserChatRate(db, userId, chatId, rate);
      await ctx.reply(`Got it! ✍️ *Group-specific* hourly rate set to \`$${rate}/hr\``, {
        parse_mode: "Markdown",
      });
    }
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
        "Hold your horses! 🐴 Usage: `/setaddress <USDT_address>`\nExample: `/setaddress TXyz...`",
        { parse_mode: "Markdown" }
      );
      return;
    }

    await upsertUser(db, userId);
    await setPaymentAddress(db, userId, address);

    await ctx.reply(`All set! 🏦 Payment address updated to \`${address}\``, {
      parse_mode: "Markdown",
    });
  });

  // /setremark <remark>
  bot.command("setremark", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    if (!ctx.chat || ctx.chat.type !== "private") {
      await ctx.reply("Psst! 🤫 Tom's Bill Bot says the `/setremark` command can only be used in our secret DMs.");
      return;
    }

    const { db } = getCtx();
    const text = ctx.message?.text ?? "";
    const remark = text.replace(/^\/setremark\s*/, "").trim();

    if (!remark) {
      await ctx.reply(
        "Hold your horses! 🐴 Usage: `/setremark <remark_text>`\nExample: `/setremark Network: TRC20`",
        { parse_mode: "Markdown" }
      );
      return;
    }

    await upsertUser(db, userId);
    await setUserRemark(db, userId, remark);

    await ctx.reply(`Noted! 📝 Invoice remark set to:\n\`${remark}\``, {
      parse_mode: "Markdown",
    });
  });
}
