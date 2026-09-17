// Must be imported before any other module (see main.ts) so the tracer
// provider exists before rag.service.ts starts creating observations.
// dotenv.config() runs here (not just in main.ts) because this file's
// top-level code — which reads process.env.LANGFUSE_* — executes as soon
// as it's imported, which is before main.ts reaches its own dotenv.config().
import dotenv from 'dotenv'
dotenv.config()

import { NodeSDK } from '@opentelemetry/sdk-node'
import { LangfuseSpanProcessor } from '@langfuse/otel'

export const langfuseSpanProcessor = new LangfuseSpanProcessor()

export const otelSdk = new NodeSDK({
  spanProcessors: [langfuseSpanProcessor],
})

otelSdk.start()
