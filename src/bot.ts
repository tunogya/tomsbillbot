/**
 * grammY bot setup.
 * Creates the bot instance with all command handlers registered.
 * Does NOT call bot.start() — this is for webhook/queue processing only.
 *
 * The bot receives a HandlerContext so handlers can access D1/KV
 * without module-level mutable state.
 */

import { Bot, Context } from "grammy";
import { registerStartHandler } from "./handlers/start";
import { registerConfigHandlers } from "./handlers/config";
import { registerWorkHandlers } from "./handlers/work";
import { registerInvoiceHandler } from "./handlers/invoice";
import { registerPaymentHandler } from "./handlers/payment";
import { registerResetHandler } from "./handlers/reset";
import { registerChatCleanupHandler } from "./handlers/chatCleanup";
import { registerHelpHandler } from "./handlers/help";
import type { HandlerContext } from "./env";

/**
 * Creates and configures a grammY Bot instance.
 *
 * `getCtx` returns the HandlerContext (DB, KV) for the current update.
 * This is a function so the consumer can swap bindings per-update
 * while reusing the same Bot instance across a queue batch.
 */
export function createBot(
  token: string,
  getCtx: () => HandlerContext
): Bot {
  const bot = new Bot(token);

  // Global middleware to force "reply" (quote) on all responses in groups
  bot.use(async (ctx, next) => {
    if (ctx.chat?.type !== "private" && ctx.message?.message_id) {
      const prevReply = ctx.reply.bind(ctx);
      ctx.reply = (text: string, other?: any, ...args: any[]) => {
        if (other?.reply_parameters || other?.reply_to_message_id) {
          return prevReply(text, other, ...args);
        }
        return prevReply(text, {
          reply_parameters: { message_id: ctx.message!.message_id },
          ...other,
        }, ...args);
      };
    }
    await next();
  });

  // Register all command handlers
  registerStartHandler(bot, getCtx);
  registerConfigHandlers(bot, getCtx);
  registerWorkHandlers(bot, getCtx);
  registerInvoiceHandler(bot, getCtx);
  registerPaymentHandler(bot, getCtx);
  registerResetHandler(bot, getCtx);
  registerChatCleanupHandler(bot, getCtx);
  registerHelpHandler(bot);

  // Catch-all for unhandled errors in handlers
  bot.catch((err) => {
    console.error("Bot handler error:", err);
  });

  return bot;
}
