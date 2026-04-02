import type { BotContext } from "../env";
import { resetGroupData } from "../services/db";

export function registerResetHandler(
  bot: {
    command: (cmd: string, handler: (ctx: BotContext) => Promise<void>) => void;
  }
): void {
  bot.command("reset", async (ctx) => {
    if (!ctx.chat || ctx.chat.type === "private") {
      await ctx.reply("Tom's Bill Bot needs to be in a group chat to `/reset` data.", {
        parse_mode: "Markdown",
      });
      return;
    }

    // Only group admins / creators can reset data
    const userId = ctx.from?.id;
    if (!userId) return;

    try {
      const member = await ctx.api.getChatMember(ctx.chat.id, userId);
      if (member.status !== "creator" && member.status !== "administrator") {
        await ctx.reply("Only group admins can reset billing data.");
        return;
      }
    } catch {
      await ctx.reply("Unable to verify admin status. Please make sure the bot has permission to see group members.");
      return;
    }

    const chatId = ctx.chat.id;
    const { db } = ctx;

    try {
      await resetGroupData(db, chatId);
      await ctx.reply(
        "Poof! Tom's Bill Bot has permanently reset all historical bills, work sessions, and payments for this group.",
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
