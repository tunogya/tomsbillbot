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
      await ctx.reply(ctx.t("team_empty"));
      return;
    }

    const lines = [ctx.t("team_title"), ""];

    if (activeSessions.length > 0) {
      lines.push(ctx.t("team_working"));
      const now = nowTs();
      for (const s of activeSessions) {
        const elapsedMins = Math.floor((now - s.start_time) / 60);
        lines.push(ctx.t("team_member_working", {
          name: escapeHtml(s.customer_name),
          duration: formatDuration(elapsedMins)
        }));
      }
      lines.push("");
    }

    if (summaries.length > 0) {
      lines.push(ctx.t("team_summaries"));
      for (const s of summaries) {
        const unbilledStr = s.unbilled_minutes > 0 ? `${formatDuration(s.unbilled_minutes)}h unbilled` : "All billed";
        const balanceStr = s.outstanding_cents > 0 ? `$${formatAmount(s.outstanding_cents)} due` : "Paid up";
        lines.push(ctx.t("team_member_summary", {
          name: escapeHtml(s.customer_name),
          unbilled: unbilledStr,
          balance: balanceStr
        }));
      }
    }

    await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
  });
}
