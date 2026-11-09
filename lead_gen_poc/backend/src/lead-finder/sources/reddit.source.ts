import { Injectable } from '@nestjs/common'
import { ApifyService } from '../../lib/apify/apify.service'
import { FetchedPost } from '../lead-finder.types'

// Free actor that returns Reddit's own post JSON (no Reddit account or OAuth).
// Swap for Reddit's official API here if API access is approved later.
export const REDDIT_ACTOR = 'red_crawler/reddit-search'

/** (need a developer) OR (hire app developer): Reddit search accepts OR and grouping. */
export function buildRedditSearchQuery(keywords: string[]): string {
  return keywords
    .map((k) => k.trim().replace(/[()"]/g, ''))
    .filter(Boolean)
    .map((k) => (k.includes(' ') ? `(${k})` : k))
    .join(' OR ')
}

export function normalizeRedditItem(item: Record<string, any>): FetchedPost | null {
  // Skip pinned mod posts, NSFW, removed and locked posts (nobody can reply to those).
  if (item.stickied || item.over_18 || item.removed_by_category || item.locked) return null
  const id = item.name ?? (item.id ? `t3_${item.id}` : null)
  if (!id) return null
  const permalink: string = item.permalink ?? ''
  const url = permalink.startsWith('http')
    ? permalink
    : permalink
      ? `https://www.reddit.com${permalink}`
      : item.url ?? ''
  return {
    platform: 'REDDIT',
    externalId: id,
    source: item.subreddit ?? null,
    title: item.title ?? null,
    body: item.selftext ?? '',
    author: item.author && item.author !== '[deleted]' ? item.author : null,
    url,
    postedAt: item.created_utc ? new Date(item.created_utc * 1000) : null,
    platformScore: Number(item.score ?? 0),
    commentCount: Number(item.num_comments ?? 0),
  }
}

@Injectable()
export class RedditSource {
  constructor(private readonly apify: ApifyService) {}

  async search(keywords: string[], subreddits: string[], limit: number): Promise<FetchedPost[]> {
    let items: Record<string, any>[]
    if (this.apify.isMock) {
      items = this.apify.readSample('reddit-sample')
    } else {
      const input: Record<string, unknown> = {
        search_type: 'posts',
        search_query: buildRedditSearchQuery(keywords),
        search_sort: 'new',
        search_time_filter: 'month',
        search_limit: limit,
      }
      if (subreddits.length) input.search_subreddit = subreddits.join(',')
      const run = await this.apify.runActor(REDDIT_ACTOR, input, limit)
      items = run.items
      this.apify.saveSample('reddit-sample', items)
    }
    return items.map(normalizeRedditItem).filter((p): p is FetchedPost => p !== null)
  }
}
