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

/**
 * Send a Telegram message via Bot API using plain fetch (stateless/standalone).
 * Used by background tasks (Cron/Cleanup) where a grammY Context isn't available.
 */
export async function sendTelegramMessage(
  botToken: string,
  chatId: number,
  text: string,
  parseMode: "Markdown" | "HTML" = "Markdown"
): Promise<boolean> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: parseMode,
      }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      console.warn(`[botUtils] sendMessage failed for chat ${chatId}: ${resp.status} ${body}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[botUtils] sendMessage exception for chat ${chatId}:`, err);
    return false;
  }
}
