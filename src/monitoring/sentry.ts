import * as Sentry from '@sentry/nestjs'
import { redactPii } from '../common/utils/pii-redaction.util'
import { APP_VERSION } from './monitoring.constants'

// Error tracking. Does nothing until SENTRY_DSN is set, so local runs and
// environments without Sentry are unaffected.
export function initSentry(): boolean {
  const dsn = process.env.SENTRY_DSN
  if (!dsn) return false

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'production',
    release: APP_VERSION,
    // Errors only. The app already runs its own OpenTelemetry setup for
    // Langfuse (instrumentation.ts), so Sentry must not register another.
    skipOpenTelemetrySetup: true,
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend: scrubEvent,
  })
  return true
}

// Never send tokens, cookies or request bodies (passwords, OTPs, payments).
export function scrubEvent<T extends Sentry.Event>(event: T): T {
  if (event.request) {
    delete event.request.data
    delete event.request.cookies
    if (event.request.headers) {
      for (const header of Object.keys(event.request.headers)) {
        if (/authorization|cookie|signature|token/i.test(header)) delete event.request.headers[header]
      }
    }
  }
  if (event.user) event.user = { id: event.user.id }
  if (event.message) event.message = redactPii(event.message)
  return event
}

// Reports an error that doesn't come from an HTTP request (worker, cron,
// webhook, event listener). Request errors are reported by SentryGlobalFilter.
export function captureError(error: unknown, area: string, extra?: Record<string, unknown>) {
  Sentry.withScope((scope) => {
    scope.setTag('area', area)
    if (extra) scope.setExtras(extra)
    Sentry.captureException(error)
  })
}
