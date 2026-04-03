/**
 * Work session handlers (Group commands).
 * /work - start a session
 * /done - end a session
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
  startBreak,
  resumeWork,
  isOnBreak,
  SESSION_STATUS,
} from "../services/db";
import { nowTs, durationMinutes, formatDuration, formatTimestampLocal, roundToGranularity } from "../utils/time";
import { getCachedGranularity } from "../utils/cache";
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

    // --- Handle /work <amount> [#tag] ---
    const match = ctx.match?.toString().trim();
    if (match) {
      const tagMatch = match.match(/#(\w+)/);
      const tag = tagMatch ? tagMatch[1] : null;
      const amountStr = match.replace(/#\w+/, "").trim();

      if (amountStr) {
        const amount = parseFloat(amountStr);
        if (isNaN(amount) || amount <= 0) {
          await ctx.reply(ctx.t("work_invalid_hours"), { parse_mode: "HTML" });
          return;
        }

        await upsertCustomer(db, userId, userName);
        const granularity = await getCachedGranularity(kv, db, userId, chatId);
        const rawMins = Math.round(amount * 60);
        const duration = roundToGranularity(rawMins, granularity);

        try {
          await logManualWorkSession(db, userId, chatId, duration, tag);
          const tagInfo = tag ? ` [Project: #${tag}]` : "";
          await ctx.reply(
            ctx.t("work_logged", {
              duration: formatDuration(duration),
              tag: tagInfo
            }),
            { parse_mode: "HTML" }
          );
          return;
        } catch (err) {
          console.error("Manual work log failed:", err);
          throw err;
        }
      } else if (tag) {
        // Start timer with tag
        const existing = await getActiveSession(db, userId, chatId);
        if (existing) {
          const customer = await getCustomer(db, userId);
          const metadata = customer ? parseMetadata(customer.metadata) : {};
          const tz = metadata.timezone;
          await ctx.reply(
            ctx.t("work_already_active", {
              start_time: escapeHtml(formatTimestampLocal(existing.start_time, tz))
            }),
            { parse_mode: "HTML" }
          );
          return;
        }

        await upsertCustomer(db, userId, userName);
        await startWorkSession(db, userId, chatId, tag);
        await ctx.reply(
          ctx.t("work_started", { tag: ` for #${tag}` }),
          { parse_mode: "HTML" }
        );
        return;
      }
    }

    // --- Original behavior: Start Timer ---
    const existing = await getActiveSession(db, userId, chatId);
    if (existing) {
      const customer = await getCustomer(db, userId);
      const metadata = customer ? parseMetadata(customer.metadata) : {};
      const tz = metadata.timezone;
      await ctx.reply(
        ctx.t("work_already_active", {
          start_time: escapeHtml(formatTimestampLocal(existing.start_time, tz))
        }),
        { parse_mode: "HTML" }
      );
      return;
    }

    try {
      await upsertCustomer(db, userId, userName);
      await startWorkSession(db, userId, chatId);
      await ctx.reply(
        ctx.t("work_started", { tag: "" }),
        { parse_mode: "HTML" }
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("UNIQUE constraint failed") || msg.includes("SQLITE_CONSTRAINT")) {
        await ctx.reply(ctx.t("work_already_active", { start_time: "..." }));
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
      await ctx.reply(ctx.t("work_no_active"), { parse_mode: "HTML" });
      return;
    }

    const keyboard = new InlineKeyboard()
      .text("🗑️ Discard Timer", `confirm_discard:${userId}`)
      .text("❌ Cancel", `cancel_discard:${userId}`);

    await ctx.reply("<b>⚠️ DISCARD ACTIVE TIMER?</b>", { parse_mode: "HTML", reply_markup: keyboard });
  });

  bot.callbackQuery(/^confirm_discard:(\d+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    const targetUserId = parseInt(ctx.match[1], 10);
    if (!userId || userId !== targetUserId) {
      await ctx.answerCallbackQuery({ text: ctx.t("unauthorized"), show_alert: true });
      return;
    }
    const { db } = ctx;
    await deleteActiveSession(db, userId, ctx.chat!.id);
    await ctx.editMessageText("<b>Work session cancelled! 🧹</b>", { parse_mode: "HTML" });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^cancel_discard:(\d+)$/, async (ctx) => {
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
    const session = await getActiveSession(db, userId, chatId);
    if (!session) {
      await ctx.reply(ctx.t("work_no_active"));
      return;
    }

    const endTime = nowTs();
    const granularity = await getCachedGranularity(kv, db, userId, chatId);
    const duration = durationMinutes(session.start_time, endTime, granularity);
    await completeWorkSession(db, session.id, endTime, duration);

    await ctx.reply(
      ctx.t("work_ended", { duration: formatDuration(duration) }),
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

    await ctx.reply("<b>⚠️ UNDO LAST SESSION?</b>", { parse_mode: "HTML", reply_markup: keyboard });
  });

  bot.callbackQuery(/^confirm_undo:(\d+)$/, async (ctx) => {
    const userId = ctx.from?.id;
    const targetUserId = parseInt(ctx.match[1], 10);
    if (!userId || userId !== targetUserId) {
      await ctx.answerCallbackQuery({ text: ctx.t("unauthorized"), show_alert: true });
      return;
    }
    const reverted = await undoLastWorkSession(ctx.db, userId, ctx.chat!.id);
    if (reverted) {
      await ctx.editMessageText("<b>Undo successful! ⏪</b>", { parse_mode: "HTML" });
    } else {
      await ctx.editMessageText("Nothing to undo.", { parse_mode: "HTML" });
    }
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^cancel_undo:(\d+)$/, async (ctx) => {
    await ctx.editMessageText("Undo cancelled.");
    await ctx.answerCallbackQuery();
  });

  // /break - pause current session
  bot.command("break", async (ctx) => {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (!userId || !chatId) return;
    if (!await ensureGroupChat(ctx, "break")) return;

    const session = await getActiveSession(ctx.db, userId, chatId);
    if (!session) {
      await ctx.reply(ctx.t("work_no_active"));
      return;
    }
    if (await isOnBreak(ctx.db, session.id)) {
      await ctx.reply(ctx.t("break_already"));
      return;
    }
    await startBreak(ctx.db, session.id);
    await ctx.reply(ctx.t("break_started"), { parse_mode: "HTML" });
  });

  // /resume - resume current session
  bot.command("resume", async (ctx) => {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (!userId || !chatId) return;
    if (!await ensureGroupChat(ctx, "resume")) return;

    const session = await getActiveSession(ctx.db, userId, chatId);
    if (!session || !await isOnBreak(ctx.db, session.id)) {
      await ctx.reply(ctx.t("break_not_on"));
      return;
    }
    await resumeWork(ctx.db, session.id);
    await ctx.reply(ctx.t("break_resume"), { parse_mode: "HTML" });
  });
}
