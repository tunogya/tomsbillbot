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
import { registerStatsHandler } from "./handlers/stats";
import { registerExportHandler } from "./handlers/export";
import { registerBalanceHandler } from "./handlers/balance";
import { registerChatCleanupHandler } from "./handlers/chatCleanup";
import { registerHelpHandler } from "./handlers/help";
import { checkRateLimit } from "./utils/ratelimit";
import type { AppEnv, BotContext } from "./env";

/**
 * Creates and configures a grammY Bot instance.
 *
 * `env` bindings are injected into the custom BotContext
 * via a global middleware, so all handlers have access to DB/KV.
 */
export function createBot(
  env: AppEnv
): Bot<BotContext> {
  const bot = new Bot<BotContext>(env.BOT_TOKEN);

  // Inject bindings into context
  bot.use(async (ctx, next) => {
    ctx.db = env.DB;
    ctx.kv = env.KV;
    ctx.botToken = env.BOT_TOKEN;
    await next();
  });

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

  // Rate limiting middleware — drop excessive commands
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (userId) {
      const allowed = await checkRateLimit(ctx.kv, userId);
      if (!allowed) {
        await ctx.reply("Whoa there! You're sending commands too fast. Please slow down.");
        return;
      }
    }
    await next();
  });


  // Register all command handlers
  registerStartHandler(bot);
  registerConfigHandlers(bot);
  registerWorkHandlers(bot);
  registerInvoiceHandler(bot);
  registerPaymentHandler(bot);
  registerResetHandler(bot);
  registerStatsHandler(bot);
  registerExportHandler(bot);
  registerBalanceHandler(bot);
  registerChatCleanupHandler(bot);
  registerHelpHandler(bot);

  // Catch-all for unhandled errors — notify user + log
  bot.catch(async (err) => {
    console.error("Bot handler error:", err.error);
    try {
      await err.ctx.reply("⚠️ Something went wrong. Please try again later.");
    } catch {
      // Ignore reply failure (e.g. bot was removed from group)
    }
  });

  return bot;
}

