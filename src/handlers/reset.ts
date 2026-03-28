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
      await ctx.reply("Tom's Bill Bot needs to be in a group chat to `/reset` data.", {
        parse_mode: "Markdown",
      });
      return;
    }

    const chatId = ctx.chat.id;
    const { db } = getCtx();

    try {
      await resetGroupData(db, chatId);
      await ctx.reply(
        "Poof! 💨 Tom's Bill Bot has permanently reset all historical bills, work sessions, and payments for this group.",
        { parse_mode: "Markdown" }
      );
    } catch (err) {
      console.error("Failed to reset group data:", err);
      await ctx.reply(
        "Yikes! 🔧 Tom's Bill Bot encountered an error while resetting data. Please try again later.",
        { parse_mode: "Markdown" }
      );
    }
  });
}
