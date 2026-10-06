// Must be imported before any other module (see main.ts) so the tracer
// provider exists before rag.service.ts starts creating observations.
// dotenv.config() runs here (not just in main.ts) because this file's
// top-level code — which reads process.env.LANGFUSE_* — executes as soon
// as it's imported, which is before main.ts reaches its own dotenv.config().
import dotenv from 'dotenv'
dotenv.config()

import { NodeSDK } from '@opentelemetry/sdk-node'
import { LangfuseSpanProcessor } from '@langfuse/otel'
import { redactPii } from './common/utils/pii-redaction.util'
import { initSentry } from './monitoring/sentry'

function maskDeep(value: unknown): unknown {
  if (typeof value === 'string') return redactPii(value)

  if (Array.isArray(value)) return value.map(maskDeep)

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [key, maskDeep(v)]),
    )
  }

  return value
}

export const langfuseSpanProcessor = new LangfuseSpanProcessor({
  mask: ({ data }) => maskDeep(data),
})

export const otelSdk = new NodeSDK({
  spanProcessors: [langfuseSpanProcessor],
})

otelSdk.start()

// Error tracking (no-op without SENTRY_DSN). Started here, before the app is
// imported, as Sentry requires.
initSentry()
