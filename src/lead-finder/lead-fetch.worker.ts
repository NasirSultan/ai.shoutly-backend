import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { Job, Worker } from 'bullmq'
import { Prisma } from '@prisma/client'
import { RedisService } from '../common/redis/redis.service'
import { prisma } from '../lib/prisma'
import { LEAD_FETCH_QUEUE } from './lead-fetch.queue'
import { LeadClassifierService } from './lead-classifier.service'
import { LeadFinderLimitsService } from './lead-finder-limits.service'
import { FetchedPost, LeadFetchJobData, LeadFetchJobResult, PostAnalysis, leadFinderConfig } from './lead-finder.types'
import { buildDedupeKey } from './query-key'
import { FacebookSource } from './sources/facebook.source'
import { RedditSource } from './sources/reddit.source'

/**
 * Runs one fetch for one normalized query:
 * search the platform -> skip posts already stored -> classify only new ones
 * -> write posts, cache entry and links in one transaction -> release the lock.
 *
 * Runs inside the API process for the POC. In production it can run as a
 * separate process from the same codebase (only this worker, no HTTP server).
 */
@Injectable()
export class LeadFetchWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LeadFetchWorker.name)
  private worker!: Worker<LeadFetchJobData, LeadFetchJobResult>

  constructor(
    private readonly redisService: RedisService,
    private readonly reddit: RedditSource,
    private readonly facebook: FacebookSource,
    private readonly classifier: LeadClassifierService,
    private readonly limits: LeadFinderLimitsService,
  ) {}

  onModuleInit() {
    this.worker = new Worker(LEAD_FETCH_QUEUE, (job) => this.process(job), {
      connection: this.redisService.createIORedisClient(),
      concurrency: 2,
    })
    this.worker.on('failed', (job, err) =>
      this.logger.error(`Fetch ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`),
    )
  }

  async onModuleDestroy() {
    await this.worker?.close()
  }

  async process(job: Job<LeadFetchJobData, LeadFetchJobResult>): Promise<LeadFetchJobResult> {
    const { queryKey, platform, keywords, subreddits, lockToken } = job.data
    try {
      const fetched = dedupeById(await this.search(platform, keywords, subreddits))
      return await this.store(queryKey, platform, keywords, fetched)
    } finally {
      await this.limits.releaseFetchLock(queryKey, lockToken)
    }
  }

  private async search(platform: LeadFetchJobData['platform'], keywords: string[], subreddits: string[]) {
    const cfg = leadFinderConfig()
    const mock = process.env.APIFY_MOCK === 'true'
    if (platform === 'REDDIT') {
      if (!mock) await this.limits.takeApifyCall('REDDIT', 'reddit-search')
      return this.reddit.search(keywords, subreddits, cfg.redditLimit)
    }
    if (!mock) {
      const runs = Math.min(keywords.length, cfg.facebookQueries)
      for (let i = 0; i < runs; i++) await this.limits.takeApifyCall('FACEBOOK', 'facebook-search')
    }
    return this.facebook.search(keywords, cfg.facebookLimit, cfg.facebookQueries)
  }

  private async store(
    queryKey: string,
    platform: LeadFetchJobData['platform'],
    keywords: string[],
    fetched: FetchedPost[],
  ): Promise<LeadFetchJobResult> {
    const externalIds = fetched.map((p) => p.externalId)

    const existing = await prisma.socialRawPost.findMany({
      where: { platform, externalId: { in: externalIds } },
      select: { id: true, externalId: true, poolLinks: { where: { queryKey }, select: { queryKey: true } } },
    })
    const known = new Set(existing.map((p) => p.externalId))
    const linkedToQuery = new Set(existing.filter((p) => p.poolLinks.length).map((p) => p.externalId))
    const fresh = fetched.filter((p) => !known.has(p.externalId))

    // Posts already analysed for this query (the "XYZ1" case) skip the AI entirely.
    // Posts stored by another query keep their classification but still need a
    // relevance score for this query's topic.
    const toAnalyse = fetched.filter((p) => !linkedToQuery.has(p.externalId))
    const analysed = toAnalyse.length ? await this.classifier.classify(toAnalyse, keywords) : new Map<string, PostAnalysis>()
    const now = new Date()

    const rows: Prisma.SocialRawPostCreateManyInput[] = fresh
      .filter((p) => analysed.has(p.externalId))
      .map((p) => {
        const { relevance, ...c } = analysed.get(p.externalId)!
        return {
          ...p,
          dedupeKey: buildDedupeKey(p.platform, p.externalId, p.author, p.title, p.body),
          ...c,
          fetchedAt: now,
          lastSeenAt: now,
        }
      })

    // Posts the AI couldn't analyse are not stored or linked. If any were
    // skipped, let this cache entry go stale in 2 minutes so the next request retries them.
    const incomplete = analysed.size < toAnalyse.length
    const poolFetchedAt = incomplete
      ? new Date(now.getTime() - Math.max(leadFinderConfig().freshMinutes - 2, 0) * 60_000)
      : now

    await prisma.$transaction(async (tx) => {
      if (existing.length) {
        await tx.socialRawPost.updateMany({
          where: { id: { in: existing.map((p) => p.id) } },
          data: { lastSeenAt: now },
        })
      }
      if (rows.length) await tx.socialRawPost.createMany({ data: rows, skipDuplicates: true })

      await tx.leadPool.upsert({
        where: { queryKey },
        create: { queryKey, platform, fetchedAt: poolFetchedAt },
        update: { fetchedAt: poolFetchedAt },
      })

      // Link newly analysed posts to this query with their relevance.
      const toLink = [...analysed.keys()]
      const stored = toLink.length
        ? await tx.socialRawPost.findMany({
            where: { platform, externalId: { in: toLink } },
            select: { id: true, externalId: true },
          })
        : []
      if (stored.length) {
        await tx.leadPoolPost.createMany({
          data: stored.map((p) => ({
            queryKey,
            rawPostId: p.id,
            relevance: analysed.get(p.externalId)!.relevance,
          })),
          skipDuplicates: true,
        })
      }
    })

    const result = {
      fetched: fetched.length,
      newPosts: fresh.length,
      classified: analysed.size,
      genuineLeads: rows.filter((r) => r.classification === 'GENUINE_LEAD').length,
      unclassified: toAnalyse.length - analysed.size,
    }
    this.logger.log(`Fetch ${queryKey}: ${JSON.stringify(result)}`)
    return result
  }
}

function dedupeById(posts: FetchedPost[]): FetchedPost[] {
  const byId = new Map<string, FetchedPost>()
  for (const p of posts) byId.set(p.externalId, p)
  return [...byId.values()]
}
