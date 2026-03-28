/**
 * Work session handlers (Group commands).
 * /work — start a session
 * /done — end a session
 *
 * Rules:
 * - One active session per user per group
 * - Prevents duplicates via DB query check + UNIQUE partial index
 */

import type { Context } from "grammy";
import {
  upsertUser,
  getActiveSession,
  startWorkSession,
  endWorkSession,
} from "../services/db";
import { nowUTC, durationHours, formatHours } from "../utils/time";
import type { HandlerContext } from "../env";

export function registerWorkHandlers(bot: {
  command: (cmd: string, handler: (ctx: Context) => Promise<void>) => void;
}, getCtx: () => HandlerContext): void {

  // /work — start a work session
  bot.command("work", async (ctx) => {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (!userId || !chatId) return;

    if (ctx.chat.type === "private") {
      await ctx.reply("Hey there! 🤖 Tom's Bill Bot can only process `/work` commands in group chats.", {
        parse_mode: "Markdown",
      });
      return;
    }

    const { db } = getCtx();

    // Ensure user exists
    await upsertUser(db, userId);

    // Check for existing active session (concurrency safety — also
    // backed by UNIQUE partial index idx_active_session)
    const existing = await getActiveSession(db, userId, chatId);
    if (existing) {
      await ctx.reply(
        `Tom's Bill Bot sees you're already grinding! 💼\nYou have an active session from \`${existing.start_time}\`.\nUse /done to clock out first.`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    try {
      // Start new session
      const session = await startWorkSession(db, userId, chatId);

      const userName = ctx.from?.first_name ?? "User";
      await ctx.reply(
        `*Work session started! Tom's Bill Bot is on the clock! ⏱️*\n\n` +
        `${userName}\n\n` +
        `Don't forget to use /done when you're finished.`,
        { parse_mode: "Markdown" }
      );
    } catch (err) {
      // If the UNIQUE partial index rejects a duplicate insert,
      // the user raced another /work command
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

  // /done — end a work session
  bot.command("done", async (ctx) => {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (!userId || !chatId) return;

    if (ctx.chat.type === "private") {
      await ctx.reply("Hey there! 🤖 Tom's Bill Bot can only process `/done` commands in group chats.", {
        parse_mode: "Markdown",
      });
      return;
    }

    const { db } = getCtx();

    // Find active session
    const session = await getActiveSession(db, userId, chatId);
    if (!session) {
      await ctx.reply("Tom's Bill Bot couldn't find an active work session! Use /work to clock in.");
      return;
    }

    // End session
    const endTime = nowUTC();
    const duration = durationHours(session.start_time, endTime);
    await endWorkSession(db, session.id, endTime, duration);

    const userName = ctx.from?.first_name ?? "User";
    await ctx.reply(
      `*Work session ended! Tom's Bill Bot says great job! 🏁*\n\n` +
      `${userName}\n\n` +
      `Duration: \`${formatHours(duration)} hours\``,
      { parse_mode: "Markdown" }
    );
  });
}
