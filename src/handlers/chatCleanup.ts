/**
 * Chat cleanup handler.
 *
 * Listens for `my_chat_member` updates where the bot's status transitions to
 * "left" or "kicked". When triggered, all data for that chat is deleted.
 */

import type { Bot } from "grammy";
import { resetGroupData } from "../services/db";
import type { HandlerContext } from "../env";

export function registerChatCleanupHandler(
  bot: Bot,
  getCtx: () => HandlerContext
): void {
  bot.on("my_chat_member", async (ctx) => {
    const update = ctx.myChatMember;

    // Only act on group / supergroup chats
    const chatType = update.chat.type;
    if (chatType !== "group" && chatType !== "supergroup") return;

    const newStatus = update.new_chat_member.status;

    // "left" → bot was removed (or group dissolved)
    // "kicked" → bot was explicitly banned
    if (newStatus !== "left" && newStatus !== "kicked") return;

    const chatId = update.chat.id;
    const { db } = getCtx();

    try {
      await resetGroupData(db, chatId);
      console.log(
        `[chatCleanup] Deleted all data for chat ${chatId} (bot status → ${newStatus})`
      );
    } catch (err) {
      console.error(
        `[chatCleanup] Failed to delete data for chat ${chatId}:`,
        err
      );
      throw err;
    }
  });
}
