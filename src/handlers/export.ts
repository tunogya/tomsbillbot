import { Bot, InputFile } from "grammy";
import type { BotContext } from "../env";
import { getAllInvoicesForExport, getAllWorkSessionsForExport } from "../services/db";
import { formatTimestamp, formatAmount, formatDuration } from "../utils/time";

export function registerExportHandler(bot: Bot<BotContext>): void {
  bot.command("export", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    if (ctx.chat?.type !== "private") {
      await ctx.reply("Psst! Tom's Bill Bot says you should run \`/export\` in our private DMs so I can safely send you the files.", { parse_mode: "Markdown" });
      return;
    }

    const { db } = ctx;

    try {
      await ctx.reply("Generating your export files... Please wait a moment.");

      // Fetch all data in parallel
      const [invoices, sessions] = await Promise.all([
        getAllInvoicesForExport(db, userId),
        getAllWorkSessionsForExport(db, userId)
      ]);

      // Create Invoices CSV
      const invoiceHeaders = ["ID", "Chat ID", "Status", "Total (USD)", "Amount Paid", "Amount Due", "Created Date"];
      const invoiceCsv = [
        invoiceHeaders.join(","),
        ...invoices.map(inv => [
          inv.id,
          inv.chat_id,
          inv.status,
          formatAmount(inv.total),
          formatAmount(inv.amount_paid),
          formatAmount(inv.amount_due),
          formatTimestamp(inv.created)
        ].join(","))
      ].join("\n");

      // Create Sessions CSV
      const sessionHeaders = ["ID", "Chat ID", "Status", "Start Time", "End Time", "Duration (Hours)", "Invoice ID"];
      const sessionCsv = [
        sessionHeaders.join(","),
        ...sessions.map(s => [
          s.id,
          s.chat_id,
          s.status,
          formatTimestamp(s.start_time),
          s.end_time ? formatTimestamp(s.end_time) : "Active",
          s.duration_minutes ? formatDuration(s.duration_minutes) : "0.0",
          s.invoice_id || "Uninvoiced"
        ].join(","))
      ].join("\n");

      // Send files
      const invoiceBuffer = new TextEncoder().encode(invoiceCsv);
      const sessionBuffer = new TextEncoder().encode(sessionCsv);

      await ctx.replyWithDocument(new InputFile(invoiceBuffer, "invoices_export.csv"));
      await ctx.replyWithDocument(new InputFile(sessionBuffer, "work_sessions_export.csv"));
      
      await ctx.reply("Export complete! Here are your invoices and work sessions records.");

    } catch (err) {
      console.error("Export error:", err);
      await ctx.reply("Oops! Something went wrong while generating your export.");
    }
  });
}
