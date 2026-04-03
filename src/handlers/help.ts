/**
 * /help command handler.
 * Displays available commands based on chat context (private vs group).
 */

import { Bot } from "grammy";
import type { BotContext } from "../env";

export function registerHelpHandler(bot: Bot<BotContext>): void {
  bot.command("help", async (ctx) => {
    const isPrivate = ctx.chat?.type === "private";

    if (isPrivate) {
      const lines = [
        "<b>Tom's Bill Bot - Help</b>",
        "",
        "Here's what I can do for you in our DMs:",
        "",
        "<b>Personal Settings & Data:</b>",
        "<code>/settings</code> - Interactive dashboard for rate, address, remark, and granularity",
        "<code>/export</code> - Download your invoices and work sessions as CSV",
        "",
        "<b>Group Commands (use in group chats):</b>",
        "<code>/stats</code> - View your weekly/monthly work stats",
        "<code>/history</code> - Unified activity timeline",
        "<code>/work &lt;amount&gt; [#tag]</code> - Log work hours (manual)",
        "<code>/work [#tag]</code> - Start a work session (timer)",
        "<code>/break</code> - Pause your current work session",
        "<code>/resume</code> - Resume your paused session",
        "<code>/done</code> - End your active session",
        "<code>/discard</code> - Cancel your current timer",
        "<code>/undo</code> - Revert your last work session",
        "<code>/expense &lt;amount&gt; &lt;desc&gt;</code> - Log an expense",
        "<code>/settings</code> - Interactive dashboard for group-specific settings",
        "<code>/sessions [#tag]</code> - List unbilled sessions/expenses",
        "<code>/invoice [#tag]</code> - Generate an invoice for the group",
        "<code>/invoices</code> - List recent invoices for the group",
        "<code>/void &lt;id&gt;</code> - Cancel a specific invoice",
        "<code>/balance</code> - Check your credit/debit balance",
        "<code>/stats [#tag]</code> - View your work stats",
      ];
      await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
    } else {
      const lines = [
        "<b>Tom's Bill Bot - Help</b>",
        "",
        "Here's what I can do in this group:",
        "",
        "<b>Group Commands:</b>",
        "<code>/stats [#tag]</code> - View your work stats",
        "<code>/history</code> - Unified activity timeline",
        "<code>/work &lt;amount&gt; [#tag]</code> - Log work hours (manual)",
        "<code>/work [#tag]</code> - Start a work session (timer)",
        "<code>/break</code> - Pause your current session",
        "<code>/resume</code> - Resume your paused session",
        "<code>/done</code> - End your active session",
        "<code>/discard</code> - Cancel your current timer",
        "<code>/undo</code> - Revert your last work session",
        "<code>/expense &lt;amount&gt; &lt;desc&gt;</code> - Log an expense",
        "<code>/settings</code> - Interactive dashboard for group-specific settings",
        "<code>/sessions [#tag]</code> - List unbilled sessions/expenses",
        "<code>/invoice [#tag]</code> - Generate an invoice for the group",
        "<code>/invoices</code> - List recent invoices for the group",
        "<code>/void &lt;id&gt;</code> - Cancel a specific invoice",
        "<code>/balance</code> - Check your credit/debit balance",
        "<code>/paid &lt;amount&gt;</code> - Record a payment received",
        "<code>/settle</code> - Automatically pay remaining balance",
        "<code>/reset</code> - Reset all historical data for this group",
        "",
        "<b>Personal Settings (DM me privately):</b>",
        "<code>/settings</code> - Open your interactive settings dashboard",
        "<code>/export</code> - Download your invoices and work sessions as CSV",
      ];
      await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
    }
  });
}
