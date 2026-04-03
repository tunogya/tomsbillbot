/**
 * Work session handlers (Group commands).
 * /work - start a session
 * /done - end a session
 *
 * Rules:
 * - One active session per customer per group
 * - Prevents duplicates via DB query check + UNIQUE partial index
 */

import { Bot, InlineKeyboard } from "grammy";
import {
  upsertCustomer,
  getActiveSession,
  startWorkSession,
  completeWorkSession,
  logManualWorkSession,
  deleteActiveSession,
  undoLastWorkSession,
  getCustomer,
  parseMetadata,
  SESSION_STATUS,
} from "../services/db";
import { nowTs, durationMinutes, formatDuration, formatTimestamp, formatTimestampLocal, roundToGranularity } from "../utils/time";
import { getCachedGranularity, invalidateCustomerCache } from "../utils/cache";
import { escapeHtml } from "../utils/telegram";
import type { BotContext } from "../env";

import { ensureGroupChat } from "../utils/bot";

export function registerWorkHandlers(bot: Bot<BotContext>): void {

  // /work - start a work session
  bot.command("work", async (ctx) => {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (!userId || !chatId) return;

    if (!await ensureGroupChat(ctx, "work")) return;

    const { db, kv } = ctx;
    const userName = ctx.from?.first_name ?? "User";

    // --- NEW: Handle /work <amount> ---
    const amountStr = ctx.match?.toString().trim();
    if (amountStr) {
      const amount = parseFloat(amountStr);
      if (isNaN(amount) || amount <= 0) {
        await ctx.reply(
          "Tom's Bill Bot didn't catch that. Please use a positive number for the hours, like <code>/work 1.5</code>.",
          { parse_mode: "HTML" }
        );
        return;
      }

      // Ensure customer exists (cache Telegram display name)
      await upsertCustomer(db, userId, userName);

      // Calculate final duration with user-configured granularity
      const granularity = await getCachedGranularity(kv, db, userId, chatId);
      const rawMins = Math.round(amount * 60);
      const duration = roundToGranularity(rawMins, granularity);

      try {
        await logManualWorkSession(db, userId, chatId, duration);
        await ctx.reply(
          "<b>Manual work logged! Tom's Bill Bot is impressed!</b>\n\n" +
          `Duration: <code>${escapeHtml(formatDuration(duration))} hours</code>`,
          { parse_mode: "HTML" }
        );
        return;
      } catch (err) {
        console.error("Manual work log failed:", err);
        throw err;
      }
    }

    // --- Original behavior: Start Timer ---
    // Check for existing active session
    const existing = await getActiveSession(db, userId, chatId);
    if (existing) {
      const customer = await getCustomer(db, userId);
      const metadata = customer ? parseMetadata(customer.metadata) : {};
      const tz = metadata.timezone;

      await ctx.reply(
        `Tom's Bill Bot sees you're already grinding! 💼\nYou have an active session from <code>${escapeHtml(formatTimestampLocal(existing.start_time, tz))}</code>.\nUse /done to clock out first.`,
        { parse_mode: "HTML" }
      );
      return;
    }

    try {
      // Ensure customer exists (cache Telegram display name)
      await upsertCustomer(db, userId, userName);
      const session = await startWorkSession(db, userId, chatId);

      await ctx.reply(
        "<b>Work session started! Tom's Bill Bot is on the clock!</b>\n\n" +
        "Don't forget to use /done when you're finished.",
        { parse_mode: "HTML" }
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("UNIQUE constraint failed") || msg.includes("SQLITE_CONSTRAINT")) {
        await ctx.reply(
          "Tom's Bill Bot says: You already have an active session. Use /done to clock out first."
        );
      } else {
        throw err;
      }
    }
  });

  // /discard - cancel an active work session
  bot.command("discard", async (ctx) => {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (!userId || !chatId) return;

    if (!await ensureGroupChat(ctx, "discard")) return;

    const { db } = ctx;

    const existing = await getActiveSession(db, userId, chatId);
    if (!existing) {
      await ctx.reply(
        "Tom's Bill Bot couldn't find an active work session to cancel!\n(Manual work logs via <code>/work &lt;hours&gt;</code> cannot be cancelled this way.)",
        { parse_mode: "HTML" }
      );
      return;
    }

    const keyboard = new InlineKeyboard()
      .text("🗑️ Discard Timer", `confirm_discard:${userId}`)
      .text("❌ Cancel", `cancel_discard:${userId}`);

    await ctx.reply(
      "<b>⚠️ DISCARD ACTIVE TIMER?</b>\n\n" +
      "This will permanently delete your currently active work session timer.",
      { parse_mode: "HTML", reply_markup: keyboard }
    );
  });

  bot.callbackQuery(/^confirm_discard:(\d+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    const targetUserId = parseInt(ctx.match[1], 10);
    const chatId = ctx.chat?.id;
    if (!userId || !chatId) return;

    if (userId !== targetUserId) {
      await ctx.answerCallbackQuery({
        text: "This confirmation is for someone else! ⛔",
        show_alert: true
      });
      return;
    }

    const { db } = ctx;
    const deleted = await deleteActiveSession(db, userId, chatId);
    if (deleted) {
      await ctx.editMessageText(
        "<b>Work session cancelled! Tom's Bill Bot has wiped the slate clean. 🧹</b>",
        { parse_mode: "HTML" }
      );
    } else {
      await ctx.editMessageText(
        "Tom's Bill Bot couldn't find that active session anymore. It might have already been processed.",
        { parse_mode: "HTML" }
      );
    }
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^cancel_discard:(\d+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    const targetUserId = parseInt(ctx.match[1], 10);
    if (userId !== targetUserId) {
      await ctx.answerCallbackQuery({
        text: "This confirmation is for someone else! ⛔",
        show_alert: true
      });
      return;
    }
    await ctx.editMessageText("Discard cancelled. Your timer is still running! ⏱️");
    await ctx.answerCallbackQuery();
  });

  // /done - end a work session
  bot.command("done", async (ctx) => {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (!userId || !chatId) return;

    if (!await ensureGroupChat(ctx, "done")) return;

    const { db, kv } = ctx;

    // Find active session
    const session = await getActiveSession(db, userId, chatId);
    if (!session) {
      await ctx.reply("Tom's Bill Bot couldn't find an active work session! Use /work to clock in.");
      return;
    }

    // End session with user-configured granularity
    const endTime = nowTs();
    const granularity = await getCachedGranularity(kv, db, userId, chatId);
    const duration = durationMinutes(session.start_time, endTime, granularity);
    await completeWorkSession(db, session.id, endTime, duration);

    await ctx.reply(
      "<b>Work session ended! Tom's Bill Bot says great job!</b>\n\n" +
      `Duration: <code>${escapeHtml(formatDuration(duration))} hours</code>`,
      { parse_mode: "HTML" }
    );
  });


  // /undo - revert the last uninvoiced work session
  bot.command("undo", async (ctx) => {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (!userId || !chatId) return;

    if (!await ensureGroupChat(ctx, "undo")) return;

    const keyboard = new InlineKeyboard()
      .text("⏪ Confirm Undo", `confirm_undo:${userId}`)
      .text("❌ Cancel", `cancel_undo:${userId}`);

    await ctx.reply(
      "<b>⚠️ UNDO LAST SESSION?</b>\n\n" +
      "This will delete your most recent work session or timer if it hasn't been invoiced yet.",
      { parse_mode: "HTML", reply_markup: keyboard }
    );
  });

  bot.callbackQuery(/^confirm_undo:(\d+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    const targetUserId = parseInt(ctx.match[1], 10);
    const chatId = ctx.chat?.id;
    if (!userId || !chatId) return;

    if (userId !== targetUserId) {
      await ctx.answerCallbackQuery({
        text: "This confirmation is for someone else! ⛔",
        show_alert: true
      });
      return;
    }

    const { db } = ctx;
    const reverted = await undoLastWorkSession(db, userId, chatId);
    if (reverted) {
      let msg = "";
      if (reverted.duration_minutes !== null) {
        msg = `<b>Undo successful! ⏪</b>\n\nTom's Bill Bot has deleted your last completed work session (<code>${escapeHtml(formatDuration(reverted.duration_minutes))} hours</code>).`;
      } else {
        msg = "<b>Undo successful! ⏪</b>\n\nTom's Bill Bot has deleted your currently active timer.";
      }
      await ctx.editMessageText(msg, { parse_mode: "HTML" });
    } else {
      await ctx.editMessageText(
        "Tom's Bill Bot couldn't find any recent uninvoiced work sessions to undo.",
        { parse_mode: "HTML" }
      );
    }
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^cancel_undo:(\d+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    const targetUserId = parseInt(ctx.match[1], 10);
    if (userId !== targetUserId) {
      await ctx.answerCallbackQuery({
        text: "This confirmation is for someone else! ⛔",
        show_alert: true
      });
      return;
    }
    await ctx.editMessageText("Undo cancelled. No data was deleted.");
    await ctx.answerCallbackQuery();
  });
}
