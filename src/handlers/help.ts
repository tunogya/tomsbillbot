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
        "*Tom's Bill Bot — Help 🎩*",
        "",
        "Here's what I can do for you in our DMs:",
        "",
        "*Personal Settings:*",
        "`/setrate <amount>` — Set your default hourly rate",
        "  _Example: `/setrate 50`_",
        "`/setaddress <address>` — Set your USDT payment address",
        "  _Example: `/setaddress TXyz...`_",
        "`/setremark <text>` — Set a custom note shown on your invoices",
        "  _Example: `/setremark Network: TRC20`_",
        "`/setgranularity <minutes>` — Set billing time granularity",
        "  _Example: `/setgranularity 5` (rounds to 5-min blocks)_",
        "",
        "*Group Commands (use in group chats):*",
        "`/work` — Start a work session",
        "`/done` — End your current session",
        "`/setrate <amount>` — Set a group-specific hourly rate",
        "`/invoice` — Generate an invoice for the group",
        "`/paid <amount>` — Record a payment",
        "`/reset` — Reset all historical data for the group",
        "",
        "Type /start to see your current settings.",
      ];
      await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
    } else {
      const lines = [
        "*Tom's Bill Bot — Help 🎩*",
        "",
        "Here's what I can do in this group:",
        "",
        "*Group Commands:*",
        "`/work` — Start a work session",
        "`/done` — End your current session",
        "`/setrate <amount>` — Set a group-specific hourly rate",
        "  _Example: `/setrate 50`_",
        "`/invoice` — Generate an invoice for the group",
        "`/paid <amount>` — Record a payment received",
        "`/reset` — Reset all historical data for this group",
        "",
        "*Personal Settings (DM me privately):*",
        "`/setrate <amount>` — Set your default hourly rate",
        "`/setaddress <address>` — Set your USDT payment address",
        "`/setremark <text>` — Set a custom invoice remark",
        "`/setgranularity <minutes>` — Set billing time granularity",
      ];
      await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
    }
  });
}
