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
      : ctx.t("settings_not_set");
    const remark = metadata.remark
      ? `<code>${escapeHtml(metadata.remark)}</code>`
      : ctx.t("settings_not_set");

    const lines = [
      ctx.t("start_welcome"),
      "",
      `<b>${ctx.t("start_settings")}</b>`,
      `• ${ctx.t("settings_rate")}: <code>$${formatAmount(defaultRate)}/hr</code>`,
      `• ${ctx.t("settings_granularity")}: <code>${escapeHtml(granularityLabel)}</code>`,
      `• ${ctx.t("settings_address")}: ${paymentAddress}`,
      `• ${ctx.t("settings_remark")}: ${remark}`,
      "",
      ctx.t("start_help"),
    ];

    await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
  });
}
