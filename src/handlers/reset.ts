import type { Context } from "grammy";
import { resetGroupData } from "../services/db";
import type { HandlerContext } from "../env";

export function registerResetHandler(
  bot: {
    command: (cmd: string, handler: (ctx: Context) => Promise<void>) => void;
  },
  getCtx: () => HandlerContext
): void {
  bot.command("reset", async (ctx) => {
    if (!ctx.chat || ctx.chat.type === "private") {
      await ctx.reply("The `/reset` command can only be used in groups.", {
        parse_mode: "Markdown",
      });
      return;
    }

    const chatId = ctx.chat.id;
    const { db } = getCtx();

    try {
      await resetGroupData(db, chatId);
      await ctx.reply(
        "All historical bills, work sessions, and payments for this group have been permanently reset.",
        { parse_mode: "Markdown" }
      );
    } catch (err) {
      console.error("Failed to reset group data:", err);
      await ctx.reply(
        "Failed to reset group data. Please try again later.",
        { parse_mode: "Markdown" }
      );
    }
  });
}
