import type { BotContext } from "../env";
import { getStats, getInvoiceSummary } from "../services/db";
import { getCachedUnitAmount } from "../utils/cache";
import { nowTs, formatDuration, formatAmount } from "../utils/time";

export function registerStatsHandler(bot: any): void {
  bot.command("stats", async (ctx: BotContext) => {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (!userId || !chatId) return;

    if (ctx.chat?.type === "private") {
      await ctx.reply("Tom's Bill Bot can only show stats in group chats.", { parse_mode: "Markdown" });
      return;
    }

    const { db, kv } = ctx;

    // Calculate timestamps
    const now = nowTs();
    const oneWeekAgo = now - 7 * 24 * 60 * 60;
    const oneMonthAgo = now - 30 * 24 * 60 * 60;

    // Fetch stats
    const weekStats = await getStats(db, userId, chatId, oneWeekAgo);
    const monthStats = await getStats(db, userId, chatId, oneMonthAgo);
    
    const summary = await getInvoiceSummary(db, userId, chatId);
    const unitAmount = await getCachedUnitAmount(kv, db, userId, chatId);

    const unbilledEarnings = Math.round((weekStats.unbilled_minutes / 60) * unitAmount);

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
