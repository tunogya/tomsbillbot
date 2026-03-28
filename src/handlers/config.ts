/**
 * User configuration handlers.
 * /setrate <hourly_rate>    — Set rate (dollars/hr → stored as cents)
 * /setaddress <address>     — Set payment address
 * /setremark <remark>       — Set invoice remark (stored in customer metadata)
 */

import type { Context } from "grammy";
import {
  upsertCustomer,
  setDefaultUnitAmount,
  setUnitAmount,
  updateCustomerPaymentAddress,
  getCustomer,
  updateCustomerMetadata,
  parseMetadata,
} from "../services/db";
import { formatAmount } from "../utils/time";
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

    const rateDollars = parseFloat(rateStr);
    if (isNaN(rateDollars) || rateDollars < 0) {
      await ctx.reply("Oops! Please provide a valid non-negative number for Tom's Bill Bot.");
      return;
    }

    const chatId = ctx.chat?.id;
    if (!chatId) return;

    // Convert dollars to cents
    const unitAmountCents = Math.round(rateDollars * 100);

    await upsertCustomer(db, userId, ctx.from?.first_name);

    if (ctx.chat.type === "private") {
      await setDefaultUnitAmount(db, userId, unitAmountCents);
      await ctx.reply(`Got it! ✍️ *Default* hourly rate set to \`$${formatAmount(unitAmountCents)}/hr\``, {
        parse_mode: "Markdown",
      });
    } else {
      await setUnitAmount(db, userId, chatId, unitAmountCents);
      await ctx.reply(`Got it! ✍️ *Group-specific* hourly rate set to \`$${formatAmount(unitAmountCents)}/hr\``, {
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

    await upsertCustomer(db, userId, ctx.from?.first_name);
    await updateCustomerPaymentAddress(db, userId, address);

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

    await upsertCustomer(db, userId, ctx.from?.first_name);

    // Read-modify-write metadata
    const customer = await getCustomer(db, userId);
    const metadata = customer ? parseMetadata(customer.metadata) : {};
    metadata.remark = remark;
    await updateCustomerMetadata(db, userId, metadata);

    await ctx.reply(`Noted! 📝 Invoice remark set to:\n\`${remark}\``, {
      parse_mode: "Markdown",
    });
  });
}
