/**
 * User configuration handlers.
 * /setrate <hourly_rate>    — Set rate (dollars/hr → stored as cents)
 * /setaddress <address>     — Set payment address
 * /setremark <remark>       — Set invoice remark (stored in customer metadata)
 * /setgranularity <minutes> — Set billing time granularity
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
  updatePriceMetadata,
} from "../services/db";
import { invalidateCustomerCache, invalidateRateCache, invalidateGranularityCache } from "../utils/cache";
import { formatAmount } from "../utils/time";
import type { HandlerContext } from "../env";

export function registerConfigHandlers(bot: {
  command: (cmd: string, handler: (ctx: Context) => Promise<void>) => void;
}, getCtx: () => HandlerContext): void {

  // /setrate <amount>
  bot.command("setrate", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const { db, kv } = getCtx();
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
      await invalidateRateCache(kv, userId, 0);
      await ctx.reply(`Got it! *Default* hourly rate set to \`$${formatAmount(unitAmountCents)}/hr\``, {
        parse_mode: "Markdown",
      });
    } else {
      await setUnitAmount(db, userId, chatId, unitAmountCents);
      await invalidateRateCache(kv, userId, chatId);
      await ctx.reply(`Got it! *Group-specific* hourly rate set to \`$${formatAmount(unitAmountCents)}/hr\``, {
        parse_mode: "Markdown",
      });
    }
  });

  // /setaddress <address>
  bot.command("setaddress", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const { db, kv } = getCtx();
    const text = ctx.message?.text ?? "";
    const parts = text.split(/\s+/);
    const address = parts[1];

    if (!address) {
      await ctx.reply(
        "Hold your horses! Usage: `/setaddress <USDT_address>`\nExample: `/setaddress TXyz...`",
        { parse_mode: "Markdown" }
      );
      return;
    }

    await upsertCustomer(db, userId, ctx.from?.first_name);
    await updateCustomerPaymentAddress(db, userId, address);
    await invalidateCustomerCache(kv, userId);

    await ctx.reply(`All set! Payment address updated to \`${address}\``, {
      parse_mode: "Markdown",
    });
  });

  // /setremark <remark>
  bot.command("setremark", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    if (!ctx.chat || ctx.chat.type !== "private") {
      await ctx.reply("Psst! Tom's Bill Bot says the `/setremark` command can only be used in our secret DMs.");
      return;
    }

    const { db, kv } = getCtx();
    const text = ctx.message?.text ?? "";
    const remark = text.replace(/^\/setremark\s*/, "").trim();

    if (!remark) {
      await ctx.reply(
        "Hold your horses! Usage: `/setremark <remark_text>`\nExample: `/setremark Network: TRC20`",
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
    await invalidateCustomerCache(kv, userId);

    await ctx.reply(`Noted! Invoice remark set to:\n\`${remark}\``, {
      parse_mode: "Markdown",
    });
  });

  // /setgranularity <minutes>
  bot.command("setgranularity", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const { db, kv } = getCtx();
    const text = ctx.message?.text ?? "";
    const parts = text.split(/\s+/);
    const valueStr = parts[1];

    if (!valueStr) {
      await ctx.reply(
        "Hold your horses! Usage: `/setgranularity <minutes>`\n" +
        "Examples:\n" +
        "• `/setgranularity 1` — per-minute billing\n" +
        "• `/setgranularity 5` — per-5-min blocks\n" +
        "• `/setgranularity 30` — per-half-hour (default)\n" +
        "• `/setgranularity 60` — per-hour blocks",
        { parse_mode: "Markdown" }
      );
      return;
    }

    const value = parseInt(valueStr, 10);
    if (isNaN(value) || value < 1 || value > 480) {
      await ctx.reply("Oops! Please provide a whole number between 1 and 480 (minutes).");
      return;
    }

    const chatId = ctx.chat?.id;
    if (!chatId) return;

    await upsertCustomer(db, userId, ctx.from?.first_name);

    const targetChatId = ctx.chat.type === "private" ? 0 : chatId;
    await updatePriceMetadata(db, userId, targetChatId, { granularity_minutes: value });
    await invalidateGranularityCache(kv, userId, targetChatId);

    const scope = ctx.chat.type === "private" ? "Default" : "Group-specific";
    const label = value === 1 ? "1 minute (per-minute)" :
      value === 60 ? "60 minutes (per-hour)" :
        `${value} minutes`;

    await ctx.reply(`Got it! *${scope}* billing granularity set to \`${label}\``, {
      parse_mode: "Markdown",
    });
  });
}
