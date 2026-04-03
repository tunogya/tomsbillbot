/**
 * User configuration handlers.
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

    const [customer, unitAmount, granularity] = await Promise.all([
      getCustomer(db, userId),
      getCachedUnitAmount(kv, db, userId, targetChatId),
      getCachedGranularity(kv, db, userId, targetChatId)
    ]);

    const address = customer?.payment_address || ctx.t("settings_not_set");
    const metadata = customer ? parseMetadata(customer.metadata) : {};
    const remark = metadata.remark || ctx.t("settings_not_set");
    const timezone = metadata.timezone || "UTC";
    const summaryFreq = metadata.summary_frequency || "off";
    const lang = metadata.language || "en";

    const scope = ctx.chat.type === "private" ? "Default" : "Group";
    const rateStr = unitAmount > 0 ? `${formatAmount(unitAmount)}/hr` : ctx.t("settings_not_set");
    const addressText = address === ctx.t("settings_not_set") ? address : `<code>${escapeHtml(address)}</code>`;
    const remarkText = remark === ctx.t("settings_not_set") ? remark : `<code>${escapeHtml(remark)}</code>`;

    const lines = [
      ctx.t("settings_dashboard", { scope: escapeHtml(scope) }),
      "",
      `<b>${ctx.t("settings_rate")}:</b> ${escapeHtml(rateStr)}`,
      `<b>${ctx.t("settings_granularity")}:</b> ${granularity} min`,
      `<b>${ctx.t("settings_timezone")}:</b> <code>${escapeHtml(timezone)}</code>`,
    ];

    if (ctx.chat.type === "private") {
      lines.push(
        `<b>${ctx.t("settings_address")}:</b> ${addressText}`,
        `<b>${ctx.t("settings_remark")}:</b> ${remarkText}`,
        `<b>${ctx.t("settings_summary")}:</b> <code>${escapeHtml(summaryFreq.toUpperCase())}</code>`,
        `<b>Language:</b> <code>${lang.toUpperCase()}</code>`
      );
    }

    const keyboard = new InlineKeyboard()
      .text("✏️ " + ctx.t("settings_rate"), "edit_rate")
      .text("✏️ " + ctx.t("settings_granularity"), "edit_granularity")
      .text("✏️ " + ctx.t("settings_timezone"), "edit_timezone").row();

    if (ctx.chat.type === "private") {
      keyboard
        .text("✏️ " + ctx.t("settings_address"), "edit_address")
        .text("✏️ " + ctx.t("settings_remark"), "edit_remark")
        .text("📊 " + summaryFreq.toUpperCase(), "toggle_summary").row()
        .text("🌐 " + lang.toUpperCase(), "toggle_lang");
    }

    await ctx.reply(lines.join("\n"), { parse_mode: "HTML", reply_markup: keyboard });
  });

  bot.callbackQuery(/^toggle_lang$/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    const customer = await getCustomer(ctx.db, userId);
    const metadata = customer ? parseMetadata(customer.metadata) : {};
    const current = metadata.language || "en";
    const next = current === "en" ? "zh" : "en";
    metadata.language = next;
    await updateCustomerMetadata(ctx.db, userId, metadata);
    await invalidateCustomerCache(ctx.kv, userId);
    await ctx.answerCallbackQuery({ text: `Language: ${next.toUpperCase()}` });
    // Refresh would be nice but it's okay to just answer
    await ctx.reply("Language updated. Use /settings to see changes.");
  });

  // Callbacks for settings
  bot.callbackQuery(/^edit_rate$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(ctx.t("settings_edit_rate_prompt"), {
      parse_mode: "HTML",
      reply_markup: { force_reply: true, selective: true }
    });
  });

  bot.callbackQuery(/^edit_granularity$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(ctx.t("settings_edit_granularity_prompt"), {
      parse_mode: "HTML",
      reply_markup: { force_reply: true, selective: true }
    });
  });

  bot.callbackQuery(/^edit_timezone$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(ctx.t("settings_edit_timezone_prompt"), {
      parse_mode: "HTML",
      reply_markup: { force_reply: true, selective: true }
    });
  });

  bot.callbackQuery(/^edit_address$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(ctx.t("settings_edit_address_prompt"), {
      parse_mode: "HTML",
      reply_markup: { force_reply: true, selective: true }
    });
  });

  bot.callbackQuery(/^edit_remark$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(ctx.t("settings_edit_remark_prompt"), {
      parse_mode: "HTML",
      reply_markup: { force_reply: true, selective: true }
    });
  });

  bot.callbackQuery(/^toggle_summary$/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    const customer = await getCustomer(ctx.db, userId);
    const metadata = customer ? parseMetadata(customer.metadata) : {};
    const current = metadata.summary_frequency || "off";
    const next = current === "off" ? "daily" : current === "daily" ? "weekly" : "off";
    metadata.summary_frequency = next;
    await updateCustomerMetadata(ctx.db, userId, metadata);
    await invalidateCustomerCache(ctx.kv, userId);
    await ctx.answerCallbackQuery({ text: `Summary: ${next.toUpperCase()}` });
    await ctx.reply(`Work summary frequency updated to: ${next.toUpperCase()}`);
  });

  // Handle ForceReply messages
  bot.on("message:text", async (ctx, next) => {
    const replyTo = ctx.message.reply_to_message;
    if (!replyTo || replyTo.from?.id !== ctx.me.id) return next();

    const promptText = replyTo.text || "";
    const input = ctx.message.text.trim();
    const userId = ctx.from.id;
    const { db, kv } = ctx;

    if (promptText.includes("hourly rate") || promptText.includes("时薪")) {
      const rateDollars = parseFloat(input);
      if (isNaN(rateDollars) || rateDollars < 0) {
        await ctx.reply(ctx.t("settings_invalid_number"));
        return;
      }
      const cents = Math.round(rateDollars * 100);
      await upsertCustomer(db, userId, ctx.from?.first_name);
      if (ctx.chat.type === "private") {
        await setDefaultUnitAmount(db, userId, cents);
        await invalidateRateCache(kv, userId, 0);
      } else {
        await setUnitAmount(db, userId, ctx.chat.id, cents);
        await invalidateRateCache(kv, userId, ctx.chat.id);
      }
      await ctx.reply(ctx.t("settings_updated", { field: ctx.t("settings_rate"), value: `${formatAmount(cents)}/hr` }), { parse_mode: "HTML" });

    } else if (promptText.includes("billing granularity") || promptText.includes("计费颗粒度")) {
      const value = parseInt(input, 10);
      if (isNaN(value) || value < 1 || value > 480) {
        await ctx.reply(ctx.t("settings_invalid_granularity"));
        return;
      }
      await upsertCustomer(db, userId, ctx.from?.first_name);
      const targetChatId = ctx.chat.type === "private" ? 0 : ctx.chat.id;
      await updatePriceMetadata(db, userId, targetChatId, { granularity_minutes: value });
      await invalidateGranularityCache(kv, userId, targetChatId);
      await ctx.reply(ctx.t("settings_updated", { field: ctx.t("settings_granularity"), value: `${value} min` }), { parse_mode: "HTML" });

    } else if (promptText.includes("payment address") || promptText.includes("付款地址")) {
      await upsertCustomer(db, userId, ctx.from?.first_name);
      await updateCustomerPaymentAddress(db, userId, input);
      await invalidateCustomerCache(kv, userId);
      await ctx.reply(ctx.t("settings_updated", { field: ctx.t("settings_address"), value: input }), { parse_mode: "HTML" });

    } else if (promptText.includes("invoice remark") || promptText.includes("账单备注")) {
      await upsertCustomer(db, userId, ctx.from?.first_name);
      const customer = await getCustomer(db, userId);
      const metadata = customer ? parseMetadata(customer.metadata) : {};
      metadata.remark = input;
      await updateCustomerMetadata(db, userId, metadata);
      await invalidateCustomerCache(kv, userId);
      await ctx.reply(ctx.t("settings_updated", { field: ctx.t("settings_remark"), value: input }), { parse_mode: "HTML" });

    } else if (promptText.includes("IANA timezone") || promptText.includes("IANA 时区")) {
      if (!isValidTimezone(input)) {
        await ctx.reply(ctx.t("settings_invalid_timezone"), { parse_mode: "HTML" });
        return;
      }
      await upsertCustomer(db, userId, ctx.from?.first_name);
      const customer = await getCustomer(db, userId);
      const metadata = customer ? parseMetadata(customer.metadata) : {};
      metadata.timezone = input;
      await updateCustomerMetadata(db, userId, metadata);
      await invalidateCustomerCache(kv, userId);
      await ctx.reply(ctx.t("settings_updated", { field: ctx.t("settings_timezone"), value: input }), { parse_mode: "HTML" });

    } else {
      return next();
    }
  });

  // Legacy command: /setrate <amount>
  bot.command("setrate", async (ctx) => {
    const text = ctx.message?.text ?? "";
    const rateStr = text.split(/\s+/)[1];
    if (!rateStr) {
      await ctx.reply("Usage: <code>/setrate &lt;amount&gt;</code>", { parse_mode: "HTML" });
      return;
    }
    const rateDollars = parseFloat(rateStr);
    if (isNaN(rateDollars) || rateDollars < 0) {
      await ctx.reply(ctx.t("settings_invalid_number"));
      return;
    }
    const cents = Math.round(rateDollars * 100);
    const userId = ctx.from!.id;
    await upsertCustomer(ctx.db, userId, ctx.from?.first_name);
    if (ctx.chat.type === "private") {
      await setDefaultUnitAmount(ctx.db, userId, cents);
      await invalidateRateCache(ctx.kv, userId, 0);
    } else {
      await setUnitAmount(ctx.db, userId, ctx.chat.id, cents);
      await invalidateRateCache(ctx.kv, userId, ctx.chat.id);
    }
    await ctx.reply(ctx.t("settings_updated", { field: ctx.t("settings_rate"), value: `${formatAmount(cents)}/hr` }), { parse_mode: "HTML" });
  });

  // Legacy command: /setaddress <address>
  bot.command("setaddress", async (ctx) => {
    const text = ctx.message?.text ?? "";
    const address = text.split(/\s+/)[1];
    if (!address) {
      await ctx.reply("Usage: <code>/setaddress &lt;address&gt;</code>", { parse_mode: "HTML" });
      return;
    }
    const userId = ctx.from!.id;
    await upsertCustomer(ctx.db, userId, ctx.from?.first_name);
    await updateCustomerPaymentAddress(ctx.db, userId, address);
    await invalidateCustomerCache(ctx.kv, userId);
    await ctx.reply(ctx.t("settings_updated", { field: ctx.t("settings_address"), value: address }), { parse_mode: "HTML" });
  });

  // Legacy command: /setremark <remark>
  bot.command("setremark", async (ctx) => {
    if (ctx.chat.type !== "private") {
      await ctx.reply(ctx.t("private_only"));
      return;
    }
    const remark = ctx.message?.text.replace(/^\/setremark\s*/, "").trim();
    if (!remark) {
      await ctx.reply("Usage: <code>/setremark &lt;text&gt;</code>", { parse_mode: "HTML" });
      return;
    }
    const userId = ctx.from!.id;
    await upsertCustomer(ctx.db, userId, ctx.from?.first_name);
    const customer = await getCustomer(ctx.db, userId);
    const metadata = customer ? parseMetadata(customer.metadata) : {};
    metadata.remark = remark;
    await updateCustomerMetadata(ctx.db, userId, metadata);
    await invalidateCustomerCache(ctx.kv, userId);
    await ctx.reply(ctx.t("settings_updated", { field: ctx.t("settings_remark"), value: remark }), { parse_mode: "HTML" });
  });

  // Legacy command: /setgranularity <minutes>
  bot.command("setgranularity", async (ctx) => {
    const text = ctx.message?.text ?? "";
    const valueStr = text.split(/\s+/)[1];
    if (!valueStr) {
      await ctx.reply("Usage: <code>/setgranularity &lt;minutes&gt;</code>", { parse_mode: "HTML" });
      return;
    }
    const value = parseInt(valueStr, 10);
    if (isNaN(value) || value < 1 || value > 480) {
      await ctx.reply(ctx.t("settings_invalid_granularity"));
      return;
    }
    const userId = ctx.from!.id;
    await upsertCustomer(ctx.db, userId, ctx.from?.first_name);
    const targetChatId = ctx.chat.type === "private" ? 0 : ctx.chat.id;
    await updatePriceMetadata(ctx.db, userId, targetChatId, { granularity_minutes: value });
    await invalidateGranularityCache(ctx.kv, userId, targetChatId);
    await ctx.reply(ctx.t("settings_updated", { field: ctx.t("settings_granularity"), value: `${value} min` }), { parse_mode: "HTML" });
  });
}
