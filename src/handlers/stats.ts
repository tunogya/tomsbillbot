import type { BotContext } from "../env";
import { getStats, getInvoiceSummary } from "../services/db";
import { getCachedUnitAmount } from "../utils/cache";
import { nowTs, formatDuration, formatAmount, WEEK_IN_SECONDS, MONTH_IN_SECONDS, computeAmount } from "../utils/time";
import { ensureGroupChat } from "../utils/bot";

import { ensureGroupChat } from "../utils/bot";

export function registerStatsHandler(bot: any): void {
  bot.command("stats", async (ctx: BotContext) => {
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
      `*Your Work Stats 📊*`,
      "",
      `*This Week:*`,
      `• Total Hours: \`${formatDuration(weekStats.total_minutes)} hrs\``,
      "",
      `*This Month:*`,
      `• Total Hours: \`${formatDuration(monthStats.total_minutes)} hrs\``,
      "",
      `*Current Status:*`,
      `• Unbilled Hours: \`${formatDuration(weekStats.unbilled_minutes)} hrs\``,
      `• Estimated Value: \`$${formatAmount(unbilledEarnings)}\``,
      `• Outstanding Invoices: \`$${formatAmount(Math.max(0, summary.total_invoiced - summary.total_paid))}\``
    ];

    await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
  });
}
