import type { BotContext } from "../env";

/**
 * Guard: only allow commands in group chats.
 * If used in private chat, replies with an error message and returns false.
 */
export async function ensureGroupChat(ctx: BotContext, commandName: string): Promise<boolean> {
  if (ctx.chat?.type === "private") {
    await ctx.reply(`Hey there! Tom's Bill Bot can only process \`/${commandName}\` commands in group chats.`, {
      parse_mode: "Markdown",
    });
    return false;
  }
  return true;
}
