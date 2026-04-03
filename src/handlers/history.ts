/**
 * History handler.
 * /history - unified activity timeline (sessions + invoices + payments)
 */

import { Bot } from "grammy";
import {
  getRecentWorkSessions,
  getRecentInvoices,
  getRecentPayments,
  parseMetadata,
} from "../services/db";
import { getCachedCustomer } from "../utils/cache";
import { formatAmount, formatDuration, formatTimestampLocal } from "../utils/time";
import { escapeHtml } from "../utils/telegram";
import { ensureGroupChat } from "../utils/bot";
import type { BotContext } from "../env";

export function registerHistoryHandler(bot: Bot<BotContext>): void {
  bot.command("history", async (ctx) => {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (!userId || !chatId) return;

    if (!await ensureGroupChat(ctx, "history")) return;

    const { db, kv } = ctx;

    // Fetch everything in parallel
    const [customer, sessions, invoices, payments] = await Promise.all([
      getCachedCustomer(kv, db, userId),
      getRecentWorkSessions(db, userId, chatId, 10),
      getRecentInvoices(db, userId, chatId, 10),
      getRecentPayments(db, userId, chatId, 10),
    ]);

    const metadata = customer ? parseMetadata(customer.metadata) : {};
    const tz = metadata.timezone;

    // Merge and sort
    const timeline: { type: string; ts: number; data: any }[] = [];

    for (const s of sessions) {
      timeline.push({ type: "session", ts: s.created, data: s });
    }
    for (const inv of invoices) {
      timeline.push({ type: "invoice", ts: inv.created, data: inv });
    }
    for (const p of payments) {
      timeline.push({ type: "payment", ts: p.created, data: p });
    }

    // Sort by timestamp desc
    timeline.sort((a, b) => b.ts - a.ts);

    if (timeline.length === 0) {
      await ctx.reply("Tom's Bill Bot couldn't find any activity for you in this chat yet.");
      return;
    }

    const lines = ["<b>Your Activity History 📜</b>", ""];

    // Take top 10 recent events
    for (const item of timeline.slice(0, 10)) {
      const timeStr = formatTimestampLocal(item.ts, tz);
      let eventStr = "";

      if (item.type === "session") {
        const s = item.data;
        const duration = s.duration_minutes ? `${formatDuration(s.duration_minutes)}h` : "Active";
        const status = s.status === "active" ? "⏱️ Running" : "💼 Work";
        eventStr = `${status}: <code>${duration}</code>`;
      } else if (item.type === "invoice") {
        const inv = item.data;
        const statusEmoji = inv.status === "paid" ? "✅" : inv.status === "void" ? "🗑️" : "⏳";
        eventStr = `${statusEmoji} Invoice #${inv.id}: <code>$${formatAmount(inv.total)}</code> (${inv.status})`;
      } else if (item.type === "payment") {
        const p = item.data;
        eventStr = `💳 Payment: <code>$${formatAmount(p.amount)}</code>`;
      }

      lines.push(`${escapeHtml(timeStr)}\n└ ${eventStr}`);
    }

    lines.push("", "<i>Showing up to 10 most recent events.</i>");

    await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
  });
}
