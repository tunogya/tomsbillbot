/**
 * Time & formatting utilities.
 * All timestamps are Unix seconds (integer).
 * All amounts are in cents (integer).
 */

/** Returns current time as Unix timestamp (seconds). */
export function nowTs(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Computes duration in minutes between two Unix timestamps.
 * Billing rule: minimum 30 minutes, rounds up to the nearest 30-minute block.
 */
export function durationMinutes(startTs: number, endTs: number): number {
  if (endTs <= startTs) return 0;
  const exactMinutes = Math.floor((endTs - startTs) / 60);
  const periods = Math.ceil(exactMinutes / 30);
  return Math.max(30, periods * 30);
}

/**
 * Computes amount in cents from duration (minutes) and unit price (cents/hour).
 */
export function computeAmount(minutes: number, unitAmountCentsPerHour: number): number {
  return Math.round(minutes * unitAmountCentsPerHour / 60);
}

/** Formats cents as a dollar string, e.g. 5000 → "50.00". */
export function formatAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Formats minutes as hours string, e.g. 90 → "1.50". */
export function formatDuration(minutes: number): string {
  return (minutes / 60).toFixed(2);
}

/** Formats a Unix timestamp as ISO 8601 UTC string. */
export function formatTimestamp(ts: number): string {
  return new Date(ts * 1000).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}
