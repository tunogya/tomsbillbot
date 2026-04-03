/**
 * Time & formatting utilities.
 * All timestamps are Unix seconds (integer).
 * All amounts are in cents (integer).
 */

/** Time constants. */
export const WEEK_IN_SECONDS = 7 * 24 * 60 * 60;
export const MONTH_IN_SECONDS = 30 * 24 * 60 * 60;

/** Returns current time as Unix timestamp (seconds). */
export function nowTs(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Rounds duration in minutes up to the nearest granularity block.
 * @param granularityMinutes - billing granularity in minutes (default: 30).
 */
export function roundToGranularity(minutes: number, granularityMinutes: number = 30): number {
  if (minutes <= 0) return 0;
  const periods = Math.ceil(minutes / granularityMinutes);
  return Math.max(granularityMinutes, periods * granularityMinutes);
}

/**
 * Computes duration in minutes between two Unix timestamps.
 * Billing rule: rounds up to the nearest granularity block.
 * @param granularityMinutes - billing granularity in minutes (default: 30).
 */
export function durationMinutes(startTs: number, endTs: number, granularityMinutes: number = 30): number {
  if (endTs <= startTs) return 0;
  const exactMinutes = Math.floor((endTs - startTs) / 60);
  return roundToGranularity(exactMinutes, granularityMinutes);
}

/**
 * Sums the total duration in minutes for a list of work sessions.
 */
export function sumDurations(sessions: { duration_minutes: number | null }[]): number {
  return sessions.reduce((sum, s) => sum + (s.duration_minutes ?? 0), 0);
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

/**
 * Formats a Unix timestamp using a specific IANA timezone.
 * Falls back to UTC if timezone is invalid.
 */
export function formatTimestampLocal(ts: number, tz?: string): string {
  if (!tz) return formatTimestamp(ts);
  try {
    const date = new Date(ts * 1000);
    const options: Intl.DateTimeFormatOptions = {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    };
    const formatter = new Intl.DateTimeFormat("en-GB", options);
    const parts = formatter.formatToParts(date);
    const map = new Map(parts.map(p => [p.type, p.value]));
    return `${map.get("year")}-${map.get("month")}-${map.get("day")} ${map.get("hour")}:${map.get("minute")}:${map.get("second")} ${tz}`;
  } catch {
    return formatTimestamp(ts);
  }
}

/** Validates if a string is a valid IANA timezone. */
export function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
