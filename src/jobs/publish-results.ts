// Per-platform results of publishing one calendar post, saved by the worker
// and read by the daily summary email. Kept in Redis for a few days only:
// long enough for the summary to be sent (or retried) the next day.

export interface SavedPlatformResult {
  platform: string
  accountName: string
  ok: boolean
}

export const PUBLISH_RESULTS_TTL_SECONDS = 4 * 24 * 60 * 60

export const publishResultsKey = (calendarPostId: string) => `publish-results:${calendarPostId}`
