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
      "`/setrate <amount>` — Set your hourly rate",
      "`/setaddress <address>` — Set your USDT address",
      "`/setremark <text>` — Set invoice remark",
      "`/setgranularity <minutes>` — Set billing time granularity",
      "",
      "*Group Commands:*",
      "`/work` — Start a work session",
      "`/work <amount>` — Log work hours (manual)",
      "`/cancelwork` — Cancel your current timer",
      "`/done` — End your current session",
      "`/setrate <amount>` — Set a group-specific rate",
      "`/newinvoice` — Generate an invoice",
      "`/invoices` — List recent invoices",
      "`/balance` — Check your credit/debit balance",
      "`/paid <amount>` — Record a payment",
      "`/reset` — Reset all historical data for the group",
    ];

    await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
  });
}
