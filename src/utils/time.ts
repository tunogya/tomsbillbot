/**
 * Time utilities — all timestamps in UTC.
 */

/** Returns current time as ISO 8601 UTC string. */
export function nowUTC(): string {
  return new Date().toISOString();
}

/**
 * Computes duration in hours (float) between two ISO 8601 timestamps.
 * Returns 0 if inputs are invalid.
 * Billing rule: accurate to the minute, minimum 0.5 hours, and rounds up to the next 0.5 hours.
 */
export function durationHours(start: string, end: string): number {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (isNaN(startMs) || isNaN(endMs) || endMs <= startMs) {
    return 0;
  }
  
  // Calculate exact minutes elapsed (ignoring leftover seconds)
  const minutes = Math.floor((endMs - startMs) / 60000);
  
  // Less than 30 mins counts as 30 mins (0.5 hr).
  // Over 30 mins but less than 60 mins counts as 1 hr.
  // Effectively rounds up to the nearest 30 mins block (0.5 hr chunk).
  const periods = Math.ceil(minutes / 30);
  return Math.max(0.5, periods * 0.5);
}

/** Formats a float hours value to 2 decimal places. */
export function formatHours(hours: number): string {
  return hours.toFixed(2);
}
