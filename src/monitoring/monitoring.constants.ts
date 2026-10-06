// Shared settings for health checks, heartbeats, alerts and the watchdog.

// Cron jobs that report a heartbeat after each successful run, and how long
// without one counts as "stopped".
export const CRON_HEARTBEATS = {
  checkDuePosts: { label: 'Scheduled posts (every minute)', staleAfterMs: 5 * 60 * 1000 },
  sendDueDripEmails: { label: 'Onboarding emails (every minute)', staleAfterMs: 10 * 60 * 1000 },
  cleanupOldBookings: { label: 'Demo booking cleanup (daily)', staleAfterMs: 26 * 60 * 60 * 1000 },
} as const
export type CronName = keyof typeof CRON_HEARTBEATS

// Outside services whose failures are counted.
export const EXTERNAL_SERVICES = ['outstand', 'brevo', 'deepseek', 'tavily'] as const
export type ExternalService = (typeof EXTERNAL_SERVICES)[number]

export const SERVICE_ERROR_WINDOW_MS = 15 * 60 * 1000
export const SERVICE_ERROR_THRESHOLD = 5
export const STUCK_POSTING_MS = 15 * 60 * 1000
export const QUEUE_BACKLOG_THRESHOLD = 50
// A payment marked PAID this long ago with no plan attached is a problem.
export const UNLINKED_PAYMENT_MS = 10 * 60 * 1000
// At most one email per alert key in this window.
export const ALERT_THROTTLE_MS = 30 * 60 * 1000
export const ALERT_HISTORY_SIZE = 200

export const PUBLISH_QUEUE_NAME = 'facebook-post'

export const REDIS_KEYS = {
  heartbeat: (name: CronName) => `monitoring:cron:${name}`,
  serviceErrors: (service: ExternalService) => `monitoring:svc-errors:${service}`,
  alertThrottle: (key: string) => `monitoring:alert-throttle:${key}`,
  alertHistory: 'monitoring:alerts',
  lastFailedPostsCheck: 'monitoring:last-failed-posts-check',
}

// The deployed git commit (set by Render), shown in health checks and alerts.
export const APP_VERSION = process.env.RENDER_GIT_COMMIT?.slice(0, 7) || 'local'
