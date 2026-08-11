import { IANAZone } from 'luxon'

export const DEFAULT_TIMEZONE = 'UTC'

// Some frontend timezone pickers send a full display label instead of the
// bare IANA identifier (e.g. "Asia/Kolkata (IST, UTC+5:30)" instead of
// "Asia/Kolkata"). Luxon silently produces an Invalid DateTime for anything
// that isn't a real IANA zone, which then prints as the literal string
// "Invalid DateTime" wherever it's formatted (emails, scheduling, etc).
// This strips a trailing " (...)" suffix before validating, so slightly-off
// input still resolves to a real zone instead of corrupting the value.
export function normalizeTimezone(raw: string | null | undefined, fallback: string = DEFAULT_TIMEZONE): string {
  if (!raw) return fallback
  const candidate = raw.trim().split(/\s*\(/)[0].trim()
  return IANAZone.isValidZone(candidate) ? candidate : fallback
}
