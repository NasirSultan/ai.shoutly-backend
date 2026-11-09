import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { FinderLeadStatus, LeadPlatform, Prisma, SearchProfile } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { LeadFetchQueue } from './lead-fetch.queue'
import { LeadFinderLimitsService } from './lead-finder-limits.service'
import { leadFinderConfig } from './lead-finder.types'
import { buildFetchJobId, buildQueryKey, normalizeTerms, queryKeyFromJobId } from './query-key'
import { ListLeadsDto } from './dto/list-leads.dto'
import { UpdateLeadDto } from './dto/update-lead.dto'

type AuthUser = { id: string }

/** Longer than the slowest expected fetch (Apify run + AI), so the lock can't expire mid-fetch. */
const LOCK_TTL_SECONDS = 600

export interface PlatformFetchState {
  platform: LeadPlatform
  status: 'ready' | 'pending'
  jobId: string | null
  lastFetchedAt: string | null
}

@Injectable()
export class LeadFinderService {
  private readonly logger = new Logger(LeadFinderService.name)

  constructor(
    private readonly queue: LeadFetchQueue,
    private readonly limits: LeadFinderLimitsService,
  ) {}

  /**
   * POST /lead-finder/fetch: cache-first. For each platform on the profile:
   * fresh cache -> attach leads now (no Apify, no AI); otherwise take the lock
   * and enqueue a fetch, or, if someone else holds it, poll their job.
   */
  async requestLeads(user: AuthUser, profileId: string) {
    const profile = await this.getOwnedProfile(user.id, profileId)
    await this.limits.takeUserFetch(user.id)

    const { freshMinutes } = leadFinderConfig()
    const freshSince = new Date(Date.now() - freshMinutes * 60_000)
    const platforms: PlatformFetchState[] = []

    for (const platform of profile.platforms) {
      const queryKey = this.queryKeyFor(profile, platform)
      const pool = await prisma.leadPool.findUnique({ where: { queryKey } })
      const lastFetchedAt = pool?.fetchedAt.toISOString() ?? null

      if (pool && pool.fetchedAt > freshSince) {
        await this.attachPoolToUser(user.id, profile, queryKey)
        platforms.push({ platform, status: 'ready', jobId: null, lastFetchedAt })
        continue
      }

      const token = await this.limits.acquireFetchLock(queryKey, LOCK_TTL_SECONDS)
      if (token) {
        const jobId = buildFetchJobId(queryKey, freshMinutes)
        await this.limits.setLockedJob(queryKey, jobId, LOCK_TTL_SECONDS)
        try {
          await this.queue.add(
            {
              queryKey,
              platform,
              keywords: profile.keywords,
              subreddits: platform === 'REDDIT' ? profile.subreddits : [],
              lockToken: token,
            },
            jobId,
          )
        } catch (err) {
          await this.limits.releaseFetchLock(queryKey, token)
          throw err
        }
        platforms.push({ platform, status: 'pending', jobId, lastFetchedAt })
      } else {
        // Another request is already fetching this exact query: wait on its job.
        const jobId = (await this.limits.getLockedJob(queryKey)) ?? buildFetchJobId(queryKey, freshMinutes)
        platforms.push({ platform, status: 'pending', jobId, lastFetchedAt })
      }
    }

    return {
      profileId: profile.id,
      status: platforms.every((p) => p.status === 'ready') ? 'ready' : 'pending',
      platforms,
    }
  }

  /** GET /lead-finder/fetch/:jobId?profileId=: poll a cache-miss fetch; attach leads when it finishes. */
  async getFetchStatus(user: AuthUser, jobId: string, profileId: string) {
    const profile = await this.getOwnedProfile(user.id, profileId)
    const queryKey = queryKeyFromJobId(jobId)
    const platform = profile.platforms.find((p) => this.queryKeyFor(profile, p) === queryKey)
    if (!platform) throw new NotFoundException('This fetch does not belong to the profile')

    const job = await this.queue.getJob(jobId)
    const state = job ? await job.getState() : 'missing'

    if (state === 'completed' || state === 'missing') {
      const pool = await prisma.leadPool.findUnique({ where: { queryKey } })
      if (pool) {
        const added = await this.attachPoolToUser(user.id, profile, queryKey)
        return {
          jobId,
          platform,
          state: 'completed' as const,
          result: job?.returnvalue ?? null,
          leadsAdded: added,
          lastFetchedAt: pool.fetchedAt.toISOString(),
        }
      }
      if (state === 'missing') return { jobId, platform, state: 'failed' as const, error: 'Fetch not found' }
    }

    if (state === 'failed') {
      // Reddit/Facebook or the AI failed: show the most recent saved results,
      // marked "may be outdated" in the UI.
      if (await prisma.leadPool.findUnique({ where: { queryKey } })) {
        await this.attachPoolToUser(user.id, profile, queryKey)
      }
      return {
        jobId,
        platform,
        state: 'failed' as const,
        error: job?.failedReason ?? 'Fetch failed',
        outdated: true,
      }
    }

    return { jobId, platform, state: 'running' as const }
  }

  async listLeads(user: AuthUser, q: ListLeadsDto) {
    const page = q.page ?? 1
    const pageSize = q.pageSize ?? 30
    const { staleDays } = leadFinderConfig()
    const staleBefore = new Date(Date.now() - staleDays * 86_400_000)

    const rawPost: Prisma.SocialRawPostWhereInput = {}
    if (q.platform) rawPost.platform = q.platform
    if (q.sentiment) rawPost.sentiment = q.sentiment

    const where: Prisma.FinderLeadWhereInput = {
      userId: user.id,
      ...(q.status ? { status: q.status } : {}),
      ...(q.profileId ? { profiles: { some: { profileId: q.profileId } } } : {}),
      ...(Object.keys(rawPost).length ? { rawPost } : {}),
    }
    const orderBy: Prisma.FinderLeadOrderByWithRelationInput[] =
      q.sort === 'score' ? [{ score: 'desc' }, { createdAt: 'desc' }] : [{ rawPost: { postedAt: 'desc' } }, { createdAt: 'desc' }]

    const [leads, total, counts] = await Promise.all([
      prisma.finderLead.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          rawPost: true,
          profiles: { include: { profile: { select: { id: true, name: true } } } },
        },
      }),
      prisma.finderLead.count({ where }),
      // Tab counts ignore the status filter, so every tab shows its own number.
      prisma.finderLead.groupBy({
        by: ['status'],
        where: { ...where, status: undefined },
        _count: { _all: true },
      }),
    ])

    const statusCounts = { NEW: 0, REPLIED: 0, DISMISSED: 0 } as Record<FinderLeadStatus, number>
    counts.forEach((c) => (statusCounts[c.status] = c._count._all))

    return {
      page,
      pageSize,
      total,
      statusCounts,
      leads: leads.map((l) => ({
        id: l.id,
        status: l.status,
        notALead: l.notALead,
        score: l.score,
        relevance: l.relevance,
        createdAt: l.createdAt,
        isStale: !l.rawPost.postedAt || l.rawPost.postedAt < staleBefore,
        profiles: l.profiles.map((p) => p.profile),
        post: {
          platform: l.rawPost.platform,
          source: l.rawPost.source,
          title: l.rawPost.title,
          snippet: snippet(l.rawPost.body),
          author: l.rawPost.author,
          url: l.rawPost.url,
          postedAt: l.rawPost.postedAt,
          platformScore: l.rawPost.platformScore,
          commentCount: l.rawPost.commentCount,
          classification: l.rawPost.classification,
          intentScore: l.rawPost.intentScore,
          sentiment: l.rawPost.sentiment,
          sentimentReason: l.rawPost.sentimentReason,
          summary: l.rawPost.summary,
          need: l.rawPost.need,
        },
      })),
    }
  }

  async updateLead(user: AuthUser, id: string, dto: UpdateLeadDto) {
    const lead = await prisma.finderLead.findFirst({ where: { id, userId: user.id } })
    if (!lead) throw new NotFoundException('Lead not found')
    const data: Prisma.FinderLeadUpdateInput = {}
    if (dto.status) data.status = dto.status
    if (dto.notALead !== undefined) {
      data.notALead = dto.notALead
      if (dto.notALead) data.status = 'DISMISSED'
    }
    return prisma.finderLead.update({ where: { id }, data })
  }

  /**
   * Turns the cached posts of one query into this user's leads: genuine leads
   * above the score threshold, minus the profile's exclusion words. Existing
   * leads are never reset (status stays Replied/Dismissed), and cross-posts
   * collapse into one lead through the (userId, dedupeKey) unique key.
   */
  private async attachPoolToUser(userId: string, profile: SearchProfile, queryKey: string): Promise<number> {
    const { minScore, minRelevance } = leadFinderConfig()
    const posts = await prisma.socialRawPost.findMany({
      where: {
        poolLinks: { some: { queryKey, relevance: { gte: minRelevance } } },
        classification: 'GENUINE_LEAD',
        intentScore: { gte: minScore },
      },
      select: {
        id: true,
        dedupeKey: true,
        intentScore: true,
        title: true,
        body: true,
        poolLinks: { where: { queryKey }, select: { relevance: true } },
      },
    })

    const exclusions = normalizeTerms(profile.exclusions)
    const kept = posts.filter((p) => !matchesExclusion(`${p.title ?? ''}\n${p.body}`, exclusions))
    if (!kept.length) return 0

    const created = await prisma.finderLead.createMany({
      data: kept.map((p) => ({
        userId,
        rawPostId: p.id,
        dedupeKey: p.dedupeKey,
        score: p.intentScore,
        relevance: p.poolLinks[0]?.relevance ?? 0,
      })),
      skipDuplicates: true,
    })

    const leads = await prisma.finderLead.findMany({
      where: { userId, dedupeKey: { in: kept.map((p) => p.dedupeKey) } },
      select: { id: true },
    })
    await prisma.finderLeadProfile.createMany({
      data: leads.map((l) => ({ leadId: l.id, profileId: profile.id })),
      skipDuplicates: true,
    })
    return created.count
  }

  private async getOwnedProfile(userId: string, profileId: string) {
    const profile = await prisma.searchProfile.findFirst({ where: { id: profileId, userId } })
    if (!profile) throw new NotFoundException('Search profile not found')
    return profile
  }

  private queryKeyFor(profile: SearchProfile, platform: LeadPlatform) {
    return buildQueryKey(platform, profile.keywords, profile.subreddits)
  }
}

export function matchesExclusion(text: string, exclusions: string[]): boolean {
  if (!exclusions.length) return false
  const haystack = text.toLowerCase()
  return exclusions.some((word) => haystack.includes(word))
}

function snippet(body: string, max = 320) {
  const clean = body.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max).trimEnd()}…` : clean
}
