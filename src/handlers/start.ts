/**
 * /start command handler.
 * Ensures user exists in DB, sends welcome message.
 */

import type { Context } from "grammy";
import { upsertUser, getUser } from "../services/db";
import type { HandlerContext } from "../env";

export function registerStartHandler(bot: {
  command: (cmd: string, handler: (ctx: Context) => Promise<void>) => void;
}, getCtx: () => HandlerContext): void {
  bot.command("start", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const { db } = getCtx();

    // Ensure user exists
    await upsertUser(db, userId);
    const user = await getUser(db, userId);

    const lines = [
      "👋 *Welcome to BillBot!*",
      "",
      "I help you track work hours and generate invoices.",
      "",
      "*Your Settings:*",
      `• Hourly Rate: \`$${user?.hourly_rate ?? 0}/hr\``,
      `• Payment Address: \`${user?.payment_address || "not set"}\``,
      "",
      "*DM Commands:*",
      "`/set_rate <amount>` — Set your hourly rate",
      "`/set_address <address>` — Set your USDT address",
      "",
      "*Group Commands:*",
      "`/work` — Start a work session",
      "`/done` — End your current session",
      "`/invoice` — Generate an invoice",
      "`/paid <amount>` — Record a payment",
    ];

    await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
  });
}
