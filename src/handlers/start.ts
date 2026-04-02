import type { Context } from "grammy";
import { upsertCustomer, getDefaultUnitAmount, getGranularity, parseMetadata } from "../services/db";
import { getCachedCustomer } from "../utils/cache";
import { formatAmount } from "../utils/time";
import type { BotContext } from "../env";

export function registerStartHandler(bot: {
  command: (cmd: string, handler: (ctx: BotContext) => Promise<void>) => void;
}): void {
  bot.command("start", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const { db, kv } = ctx;

    // Ensure customer exists
    await upsertCustomer(db, userId, ctx.from?.first_name);
    const customer = await getCachedCustomer(kv, db, userId);
    const defaultRate = await getDefaultUnitAmount(db, userId);
    const metadata = customer ? parseMetadata(customer.metadata) : {};
    const granularity = await getGranularity(db, userId, 0);

    const granularityLabel = granularity === 1 ? "1 min (per-minute)" :
      granularity === 60 ? "60 min (per-hour)" :
        `${granularity} min`;

    const lines = [
      "*Welcome to Tom's Bill Bot!*",
      "",
      "I'm Tom's personal assistant, here to help you track work hours and manage those invoices with style.",
      "",
      "*Your Settings:*",
      `• Hourly Rate: \`$${formatAmount(defaultRate)}/hr\``,
      `• Billing Granularity: \`${granularityLabel}\``,
      `• Payment Address: \`${customer?.payment_address || "not set"}\``,
      `• Remark: \`${metadata.remark || "not set"}\``,
      "",
      "*DM Commands:*",
      "`/settings` — Interactive dashboard (Rate, Address, Remark, Granularity)",
      "`/export` — Download your work history as CSV",
      "",
      "*Group Commands:*",
      "`/work` — Start a work session (timer)",
      "`/work <amount>` — Log work hours (manual)",
      "`/done` — End your active session",
      "`/discard` — Cancel your current timer",
      "`/undo` — Revert your last work session",
      "`/stats` — View your weekly/monthly work stats",
      "`/sessions` — List uninvoiced work sessions",
      "`/invoice` — Generate an invoice for the group",
      "`/invoices` — List recent invoices (Void/Pay buttons)",
      "`/balance` — Check your credit/debit balance",
      "`/paid <amount>` — Record a payment",
      "`/settle` — Pay off entire outstanding balance",
      "`/reset` — Reset all historical data for the group",
    ];

    await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
  });
}
