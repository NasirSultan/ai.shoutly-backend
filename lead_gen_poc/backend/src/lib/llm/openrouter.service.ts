import { Injectable, Logger } from '@nestjs/common'
import OpenAI from 'openai'

type ChatMessage = { role: 'system' | 'user'; content: string }

// A very cheap paid model first (under $0.001 per fetch) because free models
// are often rate-limited or take minutes per call; free ones are the fallback.
const DEFAULT_MODELS = [
  'deepseek/deepseek-v4.1-flash',
  'nvidia/nemotron-3.5-lightning:free',
  'google/gemma-4-31b-it:free',
  'google/gemma-4-26b-a4b-it:free',
]
const RATE_LIMIT_WAIT_MS = 3_000
// Auth / billing / bad-request failures are the same for every model: don't fall through.
const FATAL_STATUSES = new Set([400, 401, 402, 403])

// OpenRouter through the OpenAI SDK, the same SDK Shoutly uses for DeepSeek
// (new OpenAI({ baseURL })). Switching provider later means changing baseURL,
// key and model names only.
@Injectable()
export class OpenRouterService {
  private readonly logger = new Logger(OpenRouterService.name)
  private client?: OpenAI

  private getClient() {
    if (!this.client) {
      const apiKey = process.env.OPENROUTER_API_KEY
      if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set')
      this.client = new OpenAI({
        apiKey,
        baseURL: 'https://openrouter.ai/api/v1',
        timeout: 90_000,
        maxRetries: 0,
        defaultHeaders: { 'X-Title': 'Shoutly Lead Finder' },
      })
    }
    return this.client
  }

  get models(): string[] {
    const configured = process.env.OPENROUTER_MODEL
    const list = configured
      ? configured.split(',').map((m) => m.trim()).filter(Boolean)
      : DEFAULT_MODELS
    return list.length ? list : DEFAULT_MODELS
  }

  /**
   * Tries each model in order until one returns text that `parse` accepts.
   * A model that errors, times out, returns nothing or returns unusable output
   * falls through to the next one.
   */
  async completeParsed<T>(messages: ChatMessage[], parse: (text: string) => T | null): Promise<T> {
    let lastError: Error | undefined
    for (const model of this.models) {
      try {
        const res = await this.createWithRateLimitRetry(model, messages)
        // Free providers sometimes answer 200 with { error } and no choices.
        const text = res.choices?.[0]?.message?.content
        if (!text) {
          lastError = new Error(`Empty response from ${model}`)
          this.logger.warn(`${lastError.message}, trying next model`)
          continue
        }
        const parsed = parse(text)
        if (parsed !== null) return parsed
        lastError = new Error(`Unusable output from ${model}`)
        this.logger.warn(`${lastError.message}, trying next model:\n${text.slice(0, 400)}`)
      } catch (err: any) {
        lastError = new Error(`OpenRouter ${err?.status ?? ''} on ${model}: ${err?.message ?? err}`)
        if (FATAL_STATUSES.has(err?.status)) throw lastError
        this.logger.warn(`${lastError.message}, trying next model`)
      }
    }
    throw lastError ?? new Error('No OpenRouter models configured')
  }

  /** Free models often answer 429 when busy; one short wait usually gets through. */
  private async createWithRateLimitRetry(model: string, messages: ChatMessage[]) {
    // Classification needs no step-by-step thinking. Reasoning models otherwise
    // spend the whole token budget on hidden reasoning and return empty content.
    const body = {
      model,
      messages,
      temperature: 0,
      max_tokens: 6000,
      reasoning: { enabled: false },
    } as OpenAI.ChatCompletionCreateParamsNonStreaming
    const request = () => this.getClient().chat.completions.create(body)
    try {
      return await request()
    } catch (err: any) {
      if (err?.status !== 429) throw err
      await new Promise((r) => setTimeout(r, RATE_LIMIT_WAIT_MS))
      return request()
    }
  }
}

/** Pulls the JSON object out of a reply that may be wrapped in ```json fences or prose. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1) return null
  try {
    return JSON.parse(candidate.slice(start, end + 1))
  } catch {
    return null
  }
}
