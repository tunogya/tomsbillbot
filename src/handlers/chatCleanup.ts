/**
 * Chat cleanup handler.
 *
 * Listens for `my_chat_member` updates where the bot's status transitions to
 * "left" or "kicked". This covers two scenarios:
 *
 *   1. Bot is manually removed from a group by an admin.
 *   2. The group/supergroup is dissolved by Telegram (all members get a
 *      "left" status update for the bot as well).
 *
 * When triggered, all work sessions, invoices, and payments belonging to that
 * chat are permanently deleted for privacy and storage efficiency.
 *
 * This handler is invoked through the existing
 *   Telegram → webhook → Cloudflare Queue → consumer
 * pipeline, so it benefits from idempotency and retry semantics for free.
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

    // Only act on group / supergroup chats — ignore private DM status changes
    const chatType = update.chat.type;
    if (chatType !== "group" && chatType !== "supergroup") return;

    const newStatus = update.new_chat_member.status;

    // "left"   → bot was removed (or group dissolved)
    // "kicked" → bot was explicitly banned from the chat
    if (newStatus !== "left" && newStatus !== "kicked") return;

    const chatId = update.chat.id;
    const { db } = getCtx();

    try {
      await resetGroupData(db, chatId);
      console.log(
        `[chatCleanup] Deleted all data for chat ${chatId} (bot status → ${newStatus})`
      );
    } catch (err) {
      // Log the error; the queue will retry the message automatically
      console.error(
        `[chatCleanup] Failed to delete data for chat ${chatId}:`,
        err
      );
      // Re-throw so the queue consumer calls message.retry()
      throw err;
    }
  });
}
