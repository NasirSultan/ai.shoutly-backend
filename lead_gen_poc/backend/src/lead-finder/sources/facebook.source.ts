import { Injectable, Logger } from '@nestjs/common'
import { ApifyService } from '../../lib/apify/apify.service'
import { FetchedPost } from '../lead-finder.types'

/**
 * Facebook keyword-search actors and how to talk to each. Tried in order: an
 * actor that comes back empty with a quota/rate-limit status falls through.
 * Only the poster's display name is kept; profile URLs are dropped.
 */
interface FacebookActor {
  id: string
  input(query: string, count: number): Record<string, unknown>
  normalize(item: Record<string, any>): FetchedPost | null
}

function groupFromUrl(url: string): string | null {
  const m = /facebook\.com\/groups\/([^/?#]+)/.exec(url)
  return m ? `group ${decodeURIComponent(m[1])}` : null
}

export const FACEBOOK_ACTORS: FacebookActor[] = [
  {
    // Free tier: rate-limited after a few runs in a short window.
    id: 'scraper_one/facebook-posts-search',
    input: (query, count) => ({ query, resultsCount: count, searchType: 'latest' }),
    normalize: (item) => {
      if (!item.postId || !item.postText) return null
      const url = item.url ?? ''
      return {
        platform: 'FACEBOOK',
        externalId: String(item.postId),
        source: groupFromUrl(url),
        title: null,
        body: item.postText,
        author: item.author?.name ?? null,
        url,
        postedAt: item.timestamp ? new Date(item.timestamp) : null, // ms
        platformScore: Number(item.reactionsCount ?? 0),
        commentCount: Number(item.commentsCount ?? 0),
      }
    },
  },
  {
    // Free tier: up to 20 results per run, 1 run per 24h.
    id: 'scrapeforge/facebook-search-posts',
    input: (query, count) => ({ query, search_type: 'posts', max_results: count, recent_posts: true }),
    normalize: (item) => {
      if (!item.post_id || !item.message) return null
      const url = item.url ?? ''
      return {
        platform: 'FACEBOOK',
        externalId: String(item.post_id),
        source: groupFromUrl(url),
        title: null,
        body: item.message,
        author: item.author?.name ?? null,
        url,
        postedAt: item.timestamp ? new Date(item.timestamp * 1000) : null, // seconds
        platformScore: Number(item.reactions_count ?? 0),
        commentCount: Number(item.comments_count ?? 0),
      }
    },
  },
]

const QUOTA_MESSAGE = /rate limit|upgrade your (apify )?plan|free tier|limit reached/i

@Injectable()
export class FacebookSource {
  private readonly logger = new Logger(FacebookSource.name)

  constructor(private readonly apify: ApifyService) {}

  /** One search per keyword (up to maxQueries), merged and de-duplicated. */
  async search(keywords: string[], perQuery: number, maxQueries: number): Promise<FetchedPost[]> {
    if (this.apify.isMock) {
      return this.apify
        .readSample('facebook-sample')
        .map((item) => FACEBOOK_ACTORS[0].normalize(item))
        .filter((p): p is FetchedPost => p !== null)
    }

    const byId = new Map<string, FetchedPost>()
    for (const keyword of keywords.slice(0, maxQueries)) {
      for (const post of await this.searchOne(keyword, perQuery)) byId.set(post.externalId, post)
    }
    return [...byId.values()]
  }

  private async searchOne(query: string, count: number): Promise<FetchedPost[]> {
    const quotaMessages: string[] = []
    for (const actor of FACEBOOK_ACTORS) {
      const run = await this.apify.runActor(actor.id, actor.input(query, count), count)
      if (run.items.length > 0) {
        if (actor === FACEBOOK_ACTORS[0]) this.apify.saveSample('facebook-sample', run.items)
        return run.items.map((i) => actor.normalize(i)).filter((p): p is FetchedPost => p !== null)
      }
      if (QUOTA_MESSAGE.test(run.statusMessage)) {
        quotaMessages.push(`${actor.id}: "${run.statusMessage}"`)
        this.logger.warn(`${actor.id} is quota-limited, trying next actor`)
        continue
      }
      return [] // genuinely no results
    }
    throw new Error(`All Facebook search actors are rate-limited. ${quotaMessages.join(' | ')}`)
  }
}
