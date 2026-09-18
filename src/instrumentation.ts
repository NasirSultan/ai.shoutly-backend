// Must be imported before any other module (see main.ts) so the tracer
// provider exists before rag.service.ts starts creating observations.
// dotenv.config() runs here (not just in main.ts) because this file's
// top-level code — which reads process.env.LANGFUSE_* — executes as soon
// as it's imported, which is before main.ts reaches its own dotenv.config().
import dotenv from 'dotenv'
dotenv.config()

import { NodeSDK } from '@opentelemetry/sdk-node'
import { LangfuseSpanProcessor } from '@langfuse/otel'

// Best-effort PII scrub before traces leave for Langfuse (a third-party
// service): chat questions/answers can contain a user's email or phone
// number, and nothing upstream redacts that before it's logged. Not
// exhaustive — a determined user could still leak PII in free text no
// pattern catches — but strips the common, easily-matched cases.
const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.-]+/g
const PHONE_PATTERN = /\+?\d[\d\s().-]{7,}\d/g

function redactPii(text: string): string {
  return text
    .replace(EMAIL_PATTERN, '[redacted-email]')
    .replace(PHONE_PATTERN, '[redacted-phone]')
}

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
