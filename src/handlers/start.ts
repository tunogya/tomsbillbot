import type { Context } from "grammy";
import { upsertCustomer, getDefaultUnitAmount, parseMetadata } from "../services/db";
import { getCachedCustomer } from "../utils/cache";
import { formatAmount } from "../utils/time";
import type { HandlerContext } from "../env";

export function registerStartHandler(bot: {
  command: (cmd: string, handler: (ctx: Context) => Promise<void>) => void;
}, getCtx: () => HandlerContext): void {
  bot.command("start", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    const { db, kv } = getCtx();

    // Ensure customer exists
    await upsertCustomer(db, userId, ctx.from?.first_name);
    const customer = await getCachedCustomer(kv, db, userId);
    const defaultRate = await getDefaultUnitAmount(db, userId);
    const metadata = customer ? parseMetadata(customer.metadata) : {};

    const lines = [
      "*Welcome to Tom's Bill Bot! 🎩*",
      "",
      "I'm Tom's personal assistant, here to help you track work hours and manage those invoices with style.",
      "",
      "*Your Settings:*",
      `• Hourly Rate: \`$${formatAmount(defaultRate)}/hr\``,
      `• Payment Address: \`${customer?.payment_address || "not set"}\``,
      `• Remark: \`${metadata.remark || "not set"}\``,
      "",
      "*DM Commands:*",
      "`/setrate <amount>` — Set your hourly rate",
      "`/setaddress <address>` — Set your USDT address",
      "`/setremark <text>` — Set invoice remark",
      "",
      "*Group Commands:*",
      "`/work` — Start a work session",
      "`/done` — End your current session",
      "`/setrate <amount>` — Set a group-specific rate",
      "`/invoice` — Generate an invoice",
      "`/paid <amount>` — Record a payment",
      "`/reset` — Reset all historical data for the group",
    ];

    await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
  });
}
