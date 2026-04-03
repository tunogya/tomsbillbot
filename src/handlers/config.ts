/**
 * User configuration handlers.
 * /setrate <hourly_rate>    - Set rate (dollars/hr → stored as cents)
 * /setaddress <address>     - Set payment address
 * /setremark <remark>       - Set invoice remark (stored in customer metadata)
 * /setgranularity <minutes> - Set billing time granularity
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
import { formatAmount, isValidTimezone } from "../utils/time";
import { escapeHtml } from "../utils/telegram";
import type { BotContext } from "../env";

export function registerConfigHandlers(bot: Bot<BotContext>): void {

  // /settings - Interactive Dashboard
  bot.command("settings", async (ctx) => {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (!userId || !chatId) return;

    const { db, kv } = ctx;

    const targetChatId = ctx.chat.type === "private" ? 0 : chatId;

    // Fetch dependencies in parallel
    const [customer, unitAmount, granularity] = await Promise.all([
      getCustomer(db, userId),
      getCachedUnitAmount(kv, db, userId, targetChatId),
      getCachedGranularity(kv, db, userId, targetChatId)
    ]);

    const address = customer?.payment_address || "Not set";
    const metadata = customer ? parseMetadata(customer.metadata) : {};
    const remark = metadata.remark || "Not set";
    const timezone = metadata.timezone || "UTC";
    const summaryFreq = metadata.summary_frequency || "off";

    const scope = ctx.chat.type === "private" ? "Default" : "Group";
    const rateStr = unitAmount > 0 ? `${formatAmount(unitAmount)}/hr` : "Not set";
    const addressText = address === "Not set" ? address : `<code>${escapeHtml(address)}</code>`;
    const remarkText = remark === "Not set" ? remark : `<code>${escapeHtml(remark)}</code>`;

    const lines = [
      `<b>⚙️ Settings Dashboard (${escapeHtml(scope)})</b>`,
      "",
      `<b>Hourly Rate:</b> ${escapeHtml(rateStr)}`,
      `<b>Billing Granularity:</b> ${granularity} min`,
      `<b>Timezone:</b> <code>${escapeHtml(timezone)}</code>`,
    ];

    if (ctx.chat.type === "private") {
      lines.push(
        `<b>Payment Address:</b> ${addressText}`,
        `<b>Invoice Remark:</b> ${remarkText}`,
        `<b>Work Summary:</b> <code>${escapeHtml(summaryFreq.toUpperCase())}</code>`
      );
    }

    const keyboard = new InlineKeyboard()
      .text("✏️ Rate", "edit_rate")
      .text("✏️ Granularity", "edit_granularity")
      .text("✏️ Timezone", "edit_timezone").row();

    if (ctx.chat.type === "private") {
      keyboard
        .text("✏️ Address", "edit_address")
        .text("✏️ Remark", "edit_remark")
        .text("📊 Summary: " + summaryFreq.toUpperCase(), "toggle_summary");
    }

    await ctx.reply(lines.join("\n"), { parse_mode: "HTML", reply_markup: keyboard });
  });

  // Callbacks for settings
  bot.callbackQuery(/^edit_rate$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply("Please reply to this message with your new hourly rate (e.g., <code>50</code>):", {
      parse_mode: "HTML",
      reply_markup: { force_reply: true, selective: true }
    });
  });

  bot.callbackQuery(/^edit_granularity$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply("Please reply to this message with your new billing granularity in minutes (e.g., <code>30</code> for half-hour):", {
      parse_mode: "HTML",
      reply_markup: { force_reply: true, selective: true }
    });
  });

  bot.callbackQuery(/^edit_timezone$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply("Please reply to this message with your IANA timezone (e.g., <code>Asia/Shanghai</code>, <code>UTC</code>, <code>America/New_York</code>):", {
      parse_mode: "HTML",
      reply_markup: { force_reply: true, selective: true }
    });
  });

  bot.callbackQuery(/^edit_address$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply("Please reply to this message with your new USDT payment address:", {
      parse_mode: "HTML",
      reply_markup: { force_reply: true, selective: true }
    });
  });

  bot.callbackQuery(/^edit_remark$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply("Please reply to this message with your new invoice remark:", {
      parse_mode: "HTML",
      reply_markup: { force_reply: true, selective: true }
    });
  });

  bot.callbackQuery(/^toggle_summary$/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const { db, kv } = ctx;
    const customer = await getCustomer(db, userId);
    const metadata = customer ? parseMetadata(customer.metadata) : {};

    const current = metadata.summary_frequency || "off";
    const next = current === "off" ? "daily" : current === "daily" ? "weekly" : "off";

    metadata.summary_frequency = next;
    await updateCustomerMetadata(db, userId, metadata);
    await invalidateCustomerCache(kv, userId);

    await ctx.answerCallbackQuery({ text: `Summary frequency: ${next.toUpperCase()}` });

    // Refresh dashboard
    const [unitAmount, granularity] = await Promise.all([
      getCachedUnitAmount(kv, db, userId, 0),
      getCachedGranularity(kv, db, userId, 0)
    ]);

    const address = customer?.payment_address || "Not set";
    const remark = metadata.remark || "Not set";
    const timezone = metadata.timezone || "UTC";

    const lines = [
      `<b>⚙️ Settings Dashboard (Default)</b>`,
      "",
      `<b>Hourly Rate:</b> ${unitAmount > 0 ? `${formatAmount(unitAmount)}/hr` : "Not set"}`,
      `<b>Billing Granularity:</b> ${granularity} min`,
      `<b>Timezone:</b> <code>${escapeHtml(timezone)}</code>`,
      `<b>Payment Address:</b> ${address === "Not set" ? address : `<code>${escapeHtml(address)}</code>`}`,
      `<b>Invoice Remark:</b> ${remark === "Not set" ? remark : `<code>${escapeHtml(remark)}</code>`}`,
      `<b>Work Summary:</b> <code>${escapeHtml(next.toUpperCase())}</code>`
    ];

    const keyboard = new InlineKeyboard()
      .text("✏️ Rate", "edit_rate")
      .text("✏️ Granularity", "edit_granularity")
      .text("✏️ Timezone", "edit_timezone").row()
      .text("✏️ Address", "edit_address")
      .text("✏️ Remark", "edit_remark")
      .text("📊 Summary: " + next.toUpperCase(), "toggle_summary");

    await ctx.editMessageText(lines.join("\n"), { parse_mode: "HTML", reply_markup: keyboard });
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
      await ctx.reply(`✅ Hourly rate updated to <code>${escapeHtml(formatAmount(unitAmountCents))}/hr</code>`, { parse_mode: "HTML" });

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
      await ctx.reply(`✅ Granularity updated to <code>${value} minutes</code>`, { parse_mode: "HTML" });

    } else if (promptText.includes("payment address")) {
      await upsertCustomer(db, userId, ctx.from?.first_name);
      await updateCustomerPaymentAddress(db, userId, input);
      await invalidateCustomerCache(kv, userId);
      await ctx.reply(`✅ Payment address updated to:\n<code>${escapeHtml(input)}</code>`, {
        parse_mode: "HTML"
      });

    } else if (promptText.includes("invoice remark")) {
      await upsertCustomer(db, userId, ctx.from?.first_name);
      const customer = await getCustomer(db, userId);
      const metadata = customer ? parseMetadata(customer.metadata) : {};
      metadata.remark = input;
      await updateCustomerMetadata(db, userId, metadata);
      await invalidateCustomerCache(kv, userId);
      await ctx.reply(`✅ Invoice remark updated to:\n<code>${escapeHtml(input)}</code>`, {
        parse_mode: "HTML"
      });

    } else if (promptText.includes("IANA timezone")) {
      if (!isValidTimezone(input)) {
        await ctx.reply("Oops! That doesn't look like a valid IANA timezone (e.g., <code>Asia/Shanghai</code>). Please try again.", { parse_mode: "HTML" });
        return;
      }
      await upsertCustomer(db, userId, ctx.from?.first_name);
      const customer = await getCustomer(db, userId);
      const metadata = customer ? parseMetadata(customer.metadata) : {};
      metadata.timezone = input;
      await updateCustomerMetadata(db, userId, metadata);
      await invalidateCustomerCache(kv, userId);
      await ctx.reply(`✅ Timezone updated to: <code>${escapeHtml(input)}</code>`, {
        parse_mode: "HTML"
      });

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
      await ctx.reply("Hold your horses! Usage: <code>/setrate &lt;amount&gt;</code>\nExample: <code>/setrate 50</code>", {
        parse_mode: "HTML",
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
      await ctx.reply(`Got it! <b>Default</b> hourly rate set to <code>$${formatAmount(unitAmountCents)}/hr</code>`, {
        parse_mode: "HTML",
      });
    } else {
      await setUnitAmount(db, userId, chatId, unitAmountCents);
      await invalidateRateCache(kv, userId, chatId);
      await ctx.reply(`Got it! <b>Group-specific</b> hourly rate set to <code>$${formatAmount(unitAmountCents)}/hr</code>`, {
        parse_mode: "HTML",
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
        "Hold your horses! Usage: <code>/setaddress &lt;USDT_address&gt;</code>\nExample: <code>/setaddress TXyz...</code>",
        { parse_mode: "HTML" }
      );
      return;
    }

    await upsertCustomer(db, userId, ctx.from?.first_name);
    await updateCustomerPaymentAddress(db, userId, address);
    await invalidateCustomerCache(kv, userId);

    await ctx.reply(`All set! Payment address updated to:\n<code>${escapeHtml(address)}</code>`, {
      parse_mode: "HTML",
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
        "Hold your horses! Usage: <code>/setremark &lt;remark_text&gt;</code>\nExample: <code>/setremark Network: TRC20</code>",
        { parse_mode: "HTML" }
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

    await ctx.reply(`Noted! Invoice remark set to:\n<code>${escapeHtml(remark)}</code>`, {
      parse_mode: "HTML",
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
        "Hold your horses! Usage: <code>/setgranularity &lt;minutes&gt;</code>\n" +
        "Examples:\n" +
        "• <code>/setgranularity 1</code> - per-minute billing\n" +
        "• <code>/setgranularity 5</code> - per-5-min blocks\n" +
        "• <code>/setgranularity 30</code> - per-half-hour (default)\n" +
        "• <code>/setgranularity 60</code> - per-hour blocks",
        { parse_mode: "HTML" }
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

    await ctx.reply(`Got it! <b>${escapeHtml(scope)}</b> billing granularity set to <code>${escapeHtml(label)}</code>`, {
      parse_mode: "HTML",
    });
  });
}
