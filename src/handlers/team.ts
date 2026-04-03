/**
 * Team handler.
 * /team - Group admin dashboard: who's working now, hours per member, outstanding balance.
 */

import { Bot } from "grammy";
import { getGroupActiveSessions, getGroupMemberSummaries } from "../services/db";
import { formatAmount, formatDuration, nowTs } from "../utils/time";
import { escapeHtml } from "../utils/telegram";
import { ensureGroupChat } from "../utils/bot";
import type { BotContext } from "../env";

export function registerTeamHandler(bot: Bot<BotContext>): void {
  bot.command("team", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    if (!await ensureGroupChat(ctx, "team")) return;

    const { db } = ctx;

    // Fetch group data
    const [activeSessions, summaries] = await Promise.all([
      getGroupActiveSessions(db, chatId),
      getGroupMemberSummaries(db, chatId),
    ]);

    if (activeSessions.length === 0 && summaries.length === 0) {
      await ctx.reply("Tom's Bill Bot doesn't see any team activity in this group yet.");
      return;
    }

    const lines = ["<b>Team Dashboard 👥</b>", ""];

    if (activeSessions.length > 0) {
      lines.push("<b>⚡ Currently Working:</b>");
      const now = nowTs();
      for (const s of activeSessions) {
        const elapsedMins = Math.floor((now - s.start_time) / 60);
        lines.push(`• ${escapeHtml(s.customer_name)}: <code>${formatDuration(elapsedMins)}h</code> so far`);
      }
      lines.push("");
    }

    if (summaries.length > 0) {
      lines.push("<b>📊 Member Summaries:</b>");
      for (const s of summaries) {
        const unbilledStr = s.unbilled_minutes > 0 ? `${formatDuration(s.unbilled_minutes)}h unbilled` : "All billed";
        const balanceStr = s.outstanding_cents > 0 ? `$${formatAmount(s.outstanding_cents)} due` : "Paid up";
        lines.push(`• <b>${escapeHtml(s.customer_name)}</b>: ${unbilledStr}, ${balanceStr}`);
      }
    }

    await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
  });
}
