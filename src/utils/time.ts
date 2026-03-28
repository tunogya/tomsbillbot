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
 */
export function durationHours(start: string, end: string): number {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (isNaN(startMs) || isNaN(endMs) || endMs <= startMs) {
    return 0;
  }
  return (endMs - startMs) / (1000 * 60 * 60);
}

/** Formats a float hours value to 2 decimal places. */
export function formatHours(hours: number): string {
  return hours.toFixed(2);
}
