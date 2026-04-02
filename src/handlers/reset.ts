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
        await ctx.reply("Only group admins can reset billing data.");
        return;
      }
    } catch {
      await ctx.reply("Unable to verify admin status. Please make sure the bot has permission to see group members.");
      return;
    }

    const keyboard = new InlineKeyboard()
      .text("⚠️ Yes, Reset Everything", "confirm_reset")
      .text("❌ Cancel", "cancel_reset");

    await ctx.reply(
      "*⚠️ CRITICAL ACTION: RESET DATA*\n\n" +
      "This will permanently delete all work sessions, invoices, and payment history for this group. " +
      "This action *CANNOT* be undone.\n\n" +
      "Are you absolutely sure?",
      { parse_mode: "Markdown", reply_markup: keyboard }
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
          text: "Only group admins can confirm reset.",
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
      await ctx.editMessageText(
        "✅ *Poof!* Tom's Bill Bot has permanently reset all historical bills, work sessions, and payments for this group.",
        { parse_mode: "Markdown" }
      );
      await ctx.answerCallbackQuery();
    } catch (err) {
      console.error("Failed to reset group data:", err);
      await ctx.editMessageText(
        "❌ *Yikes!* Tom's Bill Bot encountered an error while resetting data.",
        { parse_mode: "Markdown" }
      );
      await ctx.answerCallbackQuery();
    }
  });

  bot.callbackQuery("cancel_reset", async (ctx) => {
    await ctx.editMessageText("Whew! Reset operation cancelled. No data was deleted.");
    await ctx.answerCallbackQuery();
  });
}
