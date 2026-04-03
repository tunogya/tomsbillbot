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

    // Parse tag if provided
    const match = ctx.match?.toString().trim();
    const tagMatch = match?.match(/#(\w+)/);
    const tag = tagMatch ? tagMatch[1] : null;

    // Calculate timestamps
    const now = nowTs();
    const oneWeekAgo = now - WEEK_IN_SECONDS;
    const oneMonthAgo = now - MONTH_IN_SECONDS;

    // Fetch stats in parallel
    const [weekStats, monthStats, summary, unitAmount] = await Promise.all([
      getStats(db, userId, chatId, oneWeekAgo, tag),
      getStats(db, userId, chatId, oneMonthAgo, tag),
      getInvoiceSummary(db, userId, chatId),
      getCachedUnitAmount(kv, db, userId, chatId)
    ]);

    const unbilledEarnings = computeAmount(weekStats.unbilled_minutes, unitAmount);

    const tagTitle = tag ? ` [Project: #${tag}]` : "";
    const lines = [
      ctx.t("stats_title", { tag: tagTitle }),
      "",
      ctx.t("stats_this_week"),
      ctx.t("stats_hours", { hours: formatDuration(weekStats.total_minutes) }),
      "",
      ctx.t("stats_this_month"),
      ctx.t("stats_hours", { hours: formatDuration(monthStats.total_minutes) }),
      "",
      ctx.t("stats_current_status"),
      ctx.t("stats_unbilled", { hours: formatDuration(weekStats.unbilled_minutes) }),
      ctx.t("stats_estimated", { amount: formatAmount(unbilledEarnings) }),
      ctx.t("stats_outstanding", { amount: formatAmount(Math.max(0, summary.total_invoiced - summary.total_paid)) })
    ];

    await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
  });
}
