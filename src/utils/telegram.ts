/**
 * Telegram text helpers for safe rich-text rendering and command detection.
 */

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function isCommandText(text: string | undefined): boolean {
  return typeof text === "string" && text.trimStart().startsWith("/");
}
