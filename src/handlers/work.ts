/**
 * Work session handlers (Group commands).
 * /work — start a session
 * /done — end a session
 *
 * Rules:
 * - One active session per customer per group
 * - Prevents duplicates via DB query check + UNIQUE partial index
 */

import type { Context } from "grammy";
import {
  upsertCustomer,
  getActiveSession,
  startWorkSession,
  completeWorkSession,
  logManualWorkSession,
  deleteActiveSession,
} from "../services/db";
import { nowTs, durationMinutes, formatDuration, formatTimestamp } from "../utils/time";
import { getCachedGranularity } from "../utils/cache";
import type { BotContext } from "../env";

export function registerWorkHandlers(bot: {
  command: (cmd: string, handler: (ctx: BotContext) => Promise<void>) => void;
}): void {

  // /work — start a work session
  bot.command("work", async (ctx) => {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (!userId || !chatId) return;

    if (ctx.chat.type === "private") {
      await ctx.reply("Hey there! Tom's Bill Bot can only process `/work` commands in group chats.", {
        parse_mode: "Markdown",
      });
      return;
    }

    const { db, kv } = ctx;
    const userName = ctx.from?.first_name ?? "User";

    // Ensure customer exists (cache Telegram display name)
    await upsertCustomer(db, userId, userName);

    // --- NEW: Handle /work <amount> ---
    const amountStr = ctx.match?.toString().trim();
    if (amountStr) {
      const amount = parseFloat(amountStr);
      if (isNaN(amount) || amount <= 0) {
        await ctx.reply(
          "Tom's Bill Bot didn't catch that. Please use a positive number for the hours, like `/work 1.5`.",
          { parse_mode: "Markdown" }
        );
        return;
      }

      // Calculate final duration with user-configured granularity
      const granularity = await getCachedGranularity(kv, db, userId, chatId);
      const rawMins = Math.round(amount * 60);

      // We use durationMinutes helper to ensure rounding up to granularity block
      // To use it, we need a dummy start/end range that spans rawMins
      const now = nowTs();
      const duration = durationMinutes(now - rawMins * 60, now, granularity);

      try {
        await logManualWorkSession(db, userId, chatId, duration);
        await ctx.reply(
          `*Manual work logged! Tom's Bill Bot is impressed!*\n\n` +
          `Duration: \`${formatDuration(duration)} hours\``,
          { parse_mode: "Markdown" }
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
      await ctx.reply(
        `Tom's Bill Bot sees you're already grinding! 💼\nYou have an active session from \`${formatTimestamp(existing.start_time)}\`.\nUse /done to clock out first.`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    try {
      const session = await startWorkSession(db, userId, chatId);

      await ctx.reply(
        `*Work session started! Tom's Bill Bot is on the clock!*\n\n` +
        `Don't forget to use /done when you're finished.`,
        { parse_mode: "Markdown" }
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

  // /cancelwork — cancel an active work session
  bot.command("cancelwork", async (ctx) => {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (!userId || !chatId) return;

    if (ctx.chat.type === "private") {
      await ctx.reply("Hey there! Tom's Bill Bot can only process `/cancelwork` commands in group chats.", {
        parse_mode: "Markdown",
      });
      return;
    }

    const { db } = ctx;

    const deleted = await deleteActiveSession(db, userId, chatId);
    if (deleted) {
      await ctx.reply(
        `*Work session cancelled! Tom's Bill Bot has wiped the slate clean. 🧹*`,
        { parse_mode: "Markdown" }
      );
    } else {
      await ctx.reply(
        `Tom's Bill Bot couldn't find an active work session to cancel!\n(Manual work logs via \`/work <hours>\` cannot be cancelled this way.)`,
        { parse_mode: "Markdown" }
      );
    }
  });

  // /done — end a work session
  bot.command("done", async (ctx) => {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (!userId || !chatId) return;

    if (ctx.chat.type === "private") {
      await ctx.reply("Hey there! Tom's Bill Bot can only process `/done` commands in group chats.", {
        parse_mode: "Markdown",
      });
      return;
    }

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
      `*Work session ended! Tom's Bill Bot says great job!*\n\n` +
      `Duration: \`${formatDuration(duration)} hours\``,
      { parse_mode: "Markdown" }
    );
  });
}
