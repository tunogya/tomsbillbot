import { Bot } from "grammy";
import type { BotContext } from "../env";
import { getStats, getInvoiceSummary } from "../services/db";
import { getCachedUnitAmount } from "../utils/cache";
import { nowTs, formatDuration, formatAmount, WEEK_IN_SECONDS, MONTH_IN_SECONDS, computeAmount } from "../utils/time";
import { ensureGroupChat } from "../utils/bot";

export function registerStatsHandler(bot: Bot<BotContext>): void {
  bot.command("stats", async (ctx) => {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (!userId || !chatId) return;

    if (!await ensureGroupChat(ctx, "stats")) return;

    const { db, kv } = ctx;

    // Calculate timestamps
    const now = nowTs();
    const oneWeekAgo = now - WEEK_IN_SECONDS;
    const oneMonthAgo = now - MONTH_IN_SECONDS;

    // Fetch stats in parallel
    const [weekStats, monthStats, summary, unitAmount] = await Promise.all([
      getStats(db, userId, chatId, oneWeekAgo),
      getStats(db, userId, chatId, oneMonthAgo),
      getInvoiceSummary(db, userId, chatId),
      getCachedUnitAmount(kv, db, userId, chatId)
    ]);

    const unbilledEarnings = computeAmount(weekStats.unbilled_minutes, unitAmount);

    const lines = [
      "<b>Your Work Stats 📊</b>",
      "",
      "<b>This Week:</b>",
      `• Total Hours: <code>${formatDuration(weekStats.total_minutes)} hrs</code>`,
      "",
      "<b>This Month:</b>",
      `• Total Hours: <code>${formatDuration(monthStats.total_minutes)} hrs</code>`,
      "",
      "<b>Current Status:</b>",
      `• Unbilled Hours: <code>${formatDuration(weekStats.unbilled_minutes)} hrs</code>`,
      `• Estimated Value: <code>$${formatAmount(unbilledEarnings)}</code>`,
      `• Outstanding Invoices: <code>$${formatAmount(Math.max(0, summary.total_invoiced - summary.total_paid))}</code>`
    ];

    await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
  });
}
