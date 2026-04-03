import { Bot, InlineKeyboard } from "grammy";
import type { BotContext } from "../env";
import { resetGroupData } from "../services/db";

import { ensureGroupChat } from "../utils/bot";

export function registerResetHandler(bot: Bot<BotContext>): void {
  bot.command("reset", async (ctx) => {
    if (!await ensureGroupChat(ctx, "reset")) return;

    // Only group admins / creators can reset data
    const userId = ctx.from?.id;
    if (!userId) return;

    try {
      const member = await ctx.api.getChatMember(ctx.chat.id, userId);
      if (member.status !== "creator" && member.status !== "administrator") {
        await ctx.reply(ctx.t("reset_admin_only"));
        return;
      }
    } catch {
      await ctx.reply(ctx.t("reset_verify_failed"));
      return;
    }

    const keyboard = new InlineKeyboard()
      .text(ctx.t("reset_confirm_btn"), "confirm_reset")
      .text(ctx.t("cancel"), "cancel_reset");

    await ctx.reply(
      `${ctx.t("reset_confirm_title")}\n\n${ctx.t("reset_confirm_body")}`,
      { parse_mode: "HTML", reply_markup: keyboard }
    );
  });

  bot.callbackQuery("confirm_reset", async (ctx) => {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (!userId || !chatId) return;

    // Only group admins / creators can confirm reset
    try {
      const member = await ctx.api.getChatMember(chatId, userId);
      if (member.status !== "creator" && member.status !== "administrator") {
        await ctx.answerCallbackQuery({
          text: ctx.t("reset_admin_only"),
          show_alert: true
        });
        return;
      }
    } catch {
      await ctx.answerCallbackQuery({
        text: "Unable to verify admin status.",
        show_alert: true
      });
      return;
    }

    const { db } = ctx;

    try {
      await resetGroupData(db, chatId);
      await ctx.editMessageText(ctx.t("reset_success"), { parse_mode: "HTML" });
      await ctx.answerCallbackQuery();
    } catch (err) {
      console.error("Failed to reset group data:", err);
      await ctx.editMessageText(ctx.t("error_generic"), { parse_mode: "HTML" });
      await ctx.answerCallbackQuery();
    }
  });

  bot.callbackQuery("cancel_reset", async (ctx) => {
    await ctx.editMessageText(ctx.t("reset_cancelled"));
    await ctx.answerCallbackQuery();
  });
}
