import { createHash } from 'crypto'
import { LeadPlatform } from '@prisma/client'

/** Lowercase, trim, collapse spaces, drop a leading r/, de-duplicate and sort. */
export function normalizeTerms(terms: string[] | undefined | null): string[] {
  const cleaned = (terms ?? [])
    .map((t) => t.trim().toLowerCase().replace(/\s+/g, ' ').replace(/^\/?r\//, ''))
    .filter(Boolean)
  return [...new Set(cleaned)].sort()
}

/**
 * The cache key is the query, not the user: posts are public, so two users
 * with the same keywords (and, on Reddit, the same subreddits) share one fetch.
 * No ':' in the key, because it also goes into BullMQ job ids.
 */
export function buildQueryKey(platform: LeadPlatform, keywords: string[], subreddits: string[]): string {
  const scope = {
    platform,
    keywords: normalizeTerms(keywords),
    subreddits: platform === 'REDDIT' ? normalizeTerms(subreddits) : [],
  }
  const hash = createHash('sha256').update(JSON.stringify(scope)).digest('hex').slice(0, 32)
  return `${platform.toLowerCase()}_${hash}`
}

/** Deterministic job id: one fetch per query per freshness window. */
export function buildFetchJobId(queryKey: string, freshMinutes: number, now = Date.now()): string {
  const bucket = Math.floor(now / (freshMinutes * 60_000))
  return `${queryKey}-${bucket}`
}

export function queryKeyFromJobId(jobId: string): string {
  return jobId.split('-')[0]
}

/**
 * Same author posting the same request in several places becomes one lead.
 * Without an author we can't tell, so the post is its own key.
 */
export function buildDedupeKey(
  platform: LeadPlatform,
  externalId: string,
  author: string | null,
  title: string | null,
  body: string,
): string {
  const who = author?.trim().toLowerCase()
  if (!who) return `${platform}|id|${externalId}`
  const what = (title || body).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 120)
  return `${platform}|${createHash('sha1').update(`${who}|${what}`).digest('hex')}`
}
