import { Bot } from "grammy";
import { upsertCustomer, getDefaultUnitAmount, getGranularity, parseMetadata } from "../services/db";
import { getCachedCustomer } from "../utils/cache";
import { formatAmount } from "../utils/time";
import { escapeHtml } from "../utils/telegram";
import type { BotContext } from "../env";

export function registerStartHandler(bot: Bot<BotContext>): void {
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
    const paymentAddress = customer?.payment_address
      ? `<code>${escapeHtml(customer.payment_address)}</code>`
      : "not set";
    const remark = metadata.remark
      ? `<code>${escapeHtml(metadata.remark)}</code>`
      : "not set";

    const lines = [
      "<b>Welcome to Tom's Bill Bot!</b>",
      "",
      "I'm Tom's personal assistant, here to help you track work hours and manage those invoices with style.",
      "",
      "<b>Your Settings:</b>",
      `• Hourly Rate: <code>$${formatAmount(defaultRate)}/hr</code>`,
      `• Billing Granularity: <code>${escapeHtml(granularityLabel)}</code>`,
      `• Payment Address: ${paymentAddress}`,
      `• Remark: ${remark}`,
      "",
      "<b>DM Commands:</b>",
      "<code>/settings</code> - Interactive dashboard (Rate, Address, Remark, Granularity)",
      "<code>/export</code> - Download your work history as CSV",
      "",
      "<b>Group Commands:</b>",
      "<code>/work</code> - Start a work session (timer)",
      "<code>/work &lt;amount&gt;</code> - Log work hours (manual)",
      "<code>/done</code> - End your active session",
      "<code>/discard</code> - Cancel your current timer",
      "<code>/undo</code> - Revert your last work session",
      "<code>/stats</code> - View your weekly/monthly work stats",
      "<code>/sessions</code> - List uninvoiced work sessions",
      "<code>/invoice</code> - Generate an invoice for the group",
      "<code>/invoices</code> - List recent invoices (Void/Pay buttons)",
      "<code>/balance</code> - Check your credit/debit balance",
      "<code>/paid &lt;amount&gt;</code> - Record a payment",
      "<code>/settle</code> - Pay off entire outstanding balance",
      "<code>/reset</code> - Reset all historical data for the group",
    ];

    await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
  });
}
