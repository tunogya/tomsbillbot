/**
 * /help command handler.
 * Displays available commands based on chat context (private vs group).
 */

import type { Context } from "grammy";

export function registerHelpHandler(bot: {
  command: (cmd: string, handler: (ctx: Context) => Promise<void>) => void;
}): void {
  bot.command("help", async (ctx) => {
    const isPrivate = ctx.chat?.type === "private";

    if (isPrivate) {
      const lines = [
        "*Tom's Bill Bot — Help*",
        "",
        "Here's what I can do for you in our DMs:",
        "",
        "*Personal Settings & Data:*",
        "\`/settings\` — Interactive dashboard for rate, address, remark, and granularity",
        "\`/export\` — Download your invoices and work sessions as CSV",
        "",
        "*Group Commands (use in group chats):*",
        "\`/stats\` — View your weekly/monthly work stats",
        "\`/work <amount>\` — Log work hours (manual)",
        "\`/work\` — Start a work session (timer)",
        "\`/done\` — End your active session",
        "\`/discard\` — Cancel your current timer",
        "\`/undo\` — Revert your last work session",
        "\`/settings\` — Interactive dashboard for group-specific settings",
        "\`/sessions\` — List uninvoiced work sessions before billing",
        "\`/invoice\` — Generate an invoice for the group",
        "\`/invoices\` — List recent invoices for the group",
        "\`/void <id>\` — Cancel a specific invoice",
        "\`/balance\` — Check your credit/debit balance",
        "\`/paid <amount>\` — Record a payment",
        "\`/settle\` — Automatically pay remaining balance",
        "\`/reset\` — Reset all historical data for the group",
        "",
        "Type /start to see your current settings.",
      ];
      await ctx.reply(lines.join("\\n"), { parse_mode: "Markdown" });
    } else {
      const lines = [
        "*Tom's Bill Bot — Help*",
        "",
        "Here's what I can do in this group:",
        "",
        "*Group Commands:*",
        "\`/stats\` — View your weekly/monthly work stats",
        "\`/work <amount>\` — Log work hours (manual)",
        "\`/work\` — Start a work session (timer)",
        "\`/done\` — End your active session",
        "\`/discard\` — Cancel your current timer",
        "\`/undo\` — Revert your last work session",
        "\`/settings\` — Interactive dashboard for group-specific settings",
        "\`/sessions\` — List uninvoiced work sessions before billing",
        "\`/invoice\` — Generate an invoice for the group",
        "\`/invoices\` — List recent invoices for the group",
        "\`/void <id>\` — Cancel a specific invoice",
        "\`/balance\` — Check your credit/debit balance",
        "\`/paid <amount>\` — Record a payment received",
        "\`/settle\` — Automatically pay remaining balance",
        "\`/reset\` — Reset all historical data for this group",
        "",
        "*Personal Settings (DM me privately):*",
        "\`/settings\` — Open your interactive settings dashboard",
        "\`/export\` — Download your invoices and work sessions as CSV",
      ];
      await ctx.reply(lines.join("\\n"), { parse_mode: "Markdown" });
    }
  });
}
