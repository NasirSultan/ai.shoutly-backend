import { LeadClassification, LeadPlatform, LeadSentiment } from '@prisma/client'

/** A post as returned by a platform source, before AI classification. */
export interface FetchedPost {
  platform: LeadPlatform
  externalId: string
  source: string | null
  title: string | null
  body: string
  author: string | null
  url: string
  postedAt: Date | null
  platformScore: number
  commentCount: number
}

export interface PostClassification {
  classification: LeadClassification
  intentScore: number
  sentiment: LeadSentiment
  sentimentReason: string | null
  summary: string | null
  need: string | null
}

/** Classification of the post itself plus its relevance to the search topic. */
export interface PostAnalysis extends PostClassification {
  relevance: number
}

/** BullMQ job data for one fetch of one normalized query. */
export interface LeadFetchJobData {
  queryKey: string
  platform: LeadPlatform
  keywords: string[]
  subreddits: string[]
  lockToken: string
}

export interface LeadFetchJobResult {
  fetched: number
  newPosts: number
  classified: number
  genuineLeads: number
  /** New posts the AI couldn't classify this time (retried on the next fetch) */
  unclassified: number
}

export const leadFinderConfig = () => ({
  freshMinutes: Number(process.env.LEAD_FINDER_FRESH_MINUTES ?? 30),
  minScore: Number(process.env.LEAD_FINDER_MIN_SCORE ?? 50),
  minRelevance: Number(process.env.LEAD_FINDER_MIN_RELEVANCE ?? 50),
  redditLimit: Number(process.env.LEAD_FINDER_REDDIT_LIMIT ?? 100),
  facebookLimit: Number(process.env.LEAD_FINDER_FACEBOOK_LIMIT ?? 10),
  facebookQueries: Number(process.env.LEAD_FINDER_FACEBOOK_QUERIES ?? 2),
  userFetchesPerMin: Number(process.env.LEAD_FINDER_USER_FETCHES_PER_MIN ?? 4),
  apifyCallsPerHour: Number(process.env.LEAD_FINDER_APIFY_CALLS_PER_HOUR ?? 30),
  /** Leads whose post is older than this are marked stale in the UI */
  staleDays: 7,
  retentionDays: 90,
})
