/**
 * User configuration handlers.
 * /setrate <hourly_rate>    — Set rate (dollars/hr → stored as cents)
 * /setaddress <address>     — Set payment address
 * /setremark <remark>       — Set invoice remark (stored in customer metadata)
 * /setgranularity <minutes> — Set billing time granularity
 */

import { Bot, InlineKeyboard } from "grammy";
import { getCachedUnitAmount, getCachedGranularity } from "../utils/cache";
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
import type { BotContext } from "../env";

export function registerConfigHandlers(bot: Bot<BotContext>): void {

  // /settings — Interactive Dashboard
  bot.command("settings", async (ctx) => {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (!userId || !chatId) return;

    const { db, kv } = ctx;
    await upsertCustomer(db, userId, ctx.from?.first_name);

    const customer = await getCustomer(db, userId);
    const address = customer?.payment_address || "Not set";
    const metadata = customer ? parseMetadata(customer.metadata) : {};
    const remark = metadata.remark || "Not set";

    const targetChatId = ctx.chat.type === "private" ? 0 : chatId;
    const unitAmount = await getCachedUnitAmount(kv, db, userId, targetChatId);
    const granularity = await getCachedGranularity(kv, db, userId, targetChatId);

    const scope = ctx.chat.type === "private" ? "Default" : "Group";
    const rateStr = unitAmount > 0 ? `${formatAmount(unitAmount)}/hr` : "Not set";

    const lines = [
      `*⚙️ Settings Dashboard (${scope})*`,
      "",
      `*Hourly Rate:* ${rateStr}`,
      `*Billing Granularity:* ${granularity} min`,
    ];

    if (ctx.chat.type === "private") {
      lines.push(
        `*Payment Address:* ` + (address === "Not set" ? address : `\`${address}\``),
        `*Invoice Remark:* ${remark}`
      );
    }

    const keyboard = new InlineKeyboard()
      .text("✏️ Edit Rate", "edit_rate")
      .text("✏️ Edit Granularity", "edit_granularity").row();

    if (ctx.chat.type === "private") {
      keyboard
        .text("✏️ Edit Address", "edit_address")
        .text("✏️ Edit Remark", "edit_remark");
    }

    await ctx.reply(lines.join("\n"), { parse_mode: "Markdown", reply_markup: keyboard });
  });

  // Callbacks for settings
  bot.callbackQuery(/^edit_rate$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply("Please reply to this message with your new hourly rate (e.g., `50`):", {
      parse_mode: "Markdown",
      reply_markup: { force_reply: true, selective: true }
    });
  });

  bot.callbackQuery(/^edit_granularity$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply("Please reply to this message with your new billing granularity in minutes (e.g., `30` for half-hour):", {
      parse_mode: "Markdown",
      reply_markup: { force_reply: true, selective: true }
    });
  });

  bot.callbackQuery(/^edit_address$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply("Please reply to this message with your new USDT payment address:", {
      parse_mode: "Markdown",
      reply_markup: { force_reply: true, selective: true }
    });
  });

  bot.callbackQuery(/^edit_remark$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply("Please reply to this message with your new invoice remark:", {
      parse_mode: "Markdown",
      reply_markup: { force_reply: true, selective: true }
    });
  });

  // Handle ForceReply messages
  bot.on("message:text", async (ctx, next) => {
    const replyTo = ctx.message.reply_to_message;
    if (!replyTo || replyTo.from?.id !== ctx.me.id) {
      return next();
    }

    const promptText = replyTo.text || "";
    const input = ctx.message.text.trim();
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    const { db, kv } = ctx;

    if (promptText.includes("hourly rate")) {
      const rateDollars = parseFloat(input);
      if (isNaN(rateDollars) || rateDollars < 0) {
        await ctx.reply("Oops! Please provide a valid non-negative number.");
        return;
      }
      const unitAmountCents = Math.round(rateDollars * 100);
      await upsertCustomer(db, userId, ctx.from?.first_name);

      if (ctx.chat.type === "private") {
        await setDefaultUnitAmount(db, userId, unitAmountCents);
        await invalidateRateCache(kv, userId, 0);
      } else {
        await setUnitAmount(db, userId, chatId, unitAmountCents);
        await invalidateRateCache(kv, userId, chatId);
      }
      await ctx.reply(`✅ Hourly rate updated to \`${formatAmount(unitAmountCents)}/hr\``, { parse_mode: "Markdown" });
      
    } else if (promptText.includes("billing granularity")) {
      const value = parseInt(input, 10);
      if (isNaN(value) || value < 1 || value > 480) {
        await ctx.reply("Oops! Please provide a whole number between 1 and 480.");
        return;
      }
      await upsertCustomer(db, userId, ctx.from?.first_name);
      const targetChatId = ctx.chat.type === "private" ? 0 : chatId;
      await updatePriceMetadata(db, userId, targetChatId, { granularity_minutes: value });
      await invalidateGranularityCache(kv, userId, targetChatId);
      await ctx.reply(`✅ Granularity updated to \`${value} minutes\``, { parse_mode: "Markdown" });

    } else if (promptText.includes("payment address")) {
      await upsertCustomer(db, userId, ctx.from?.first_name);
      await updateCustomerPaymentAddress(db, userId, input);
      await invalidateCustomerCache(kv, userId);
      await ctx.reply(`✅ Payment address updated to \`${input}\``, { parse_mode: "Markdown" });

    } else if (promptText.includes("invoice remark")) {
      await upsertCustomer(db, userId, ctx.from?.first_name);
      const customer = await getCustomer(db, userId);
      const metadata = customer ? parseMetadata(customer.metadata) : {};
      metadata.remark = input;
      await updateCustomerMetadata(db, userId, metadata);
      await invalidateCustomerCache(kv, userId);
      await ctx.reply(`✅ Invoice remark updated to:\n\`${input}\``, { parse_mode: "Markdown" });

    } else {
      return next();
    }
  });



  // /setrate <amount>
  bot.command("setrate", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const { db, kv } = ctx;
    const text = ctx.message?.text ?? "";
    const parts = text.split(/\s+/);
    const rateStr = parts[1];

    if (!rateStr) {
      await ctx.reply("Hold your horses! Usage: `/setrate <amount>`\nExample: `/setrate 50`", {
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

    const { db, kv } = ctx;
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

    const { db, kv } = ctx;
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

    const { db, kv } = ctx;
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
