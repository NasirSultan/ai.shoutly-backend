import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { prisma } from '../lib/prisma'
import { normalizeTerms } from '../lead-finder/query-key'
import { ProfileCrawlQueue } from './profile-crawl.queue'
import { CreateSearchProfileDto, UpdateSearchProfileDto } from './dto/search-profile.dto'

type AuthUser = { id: string }

/** Reduce any address to its home page: https://host (lowercase, no www, no path). */
export function normalizeWebsiteUrl(raw: string): string {
  const value = raw.trim()
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    throw new BadRequestException('Enter a valid website address')
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  if (!host.includes('.')) throw new BadRequestException('Enter a valid website address')
  return `https://${host}`
}

/** Keeps the user's own wording for display, but trims, drops blanks and duplicates. */
function cleanList(list: string[] | undefined): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of list ?? []) {
    const value = item.trim().replace(/\s+/g, ' ')
    const key = value.toLowerCase()
    if (value && !seen.has(key)) {
      seen.add(key)
      out.push(value)
    }
  }
  return out
}

@Injectable()
export class SearchProfilesService {
  constructor(private readonly crawlQueue: ProfileCrawlQueue) {}

  /**
   * Starts a website analysis. A pending/running analysis of the same site for
   * the same user is returned instead of starting another (double-click safe).
   * The advisory lock serialises concurrent requests for the same user + URL.
   */
  async startCrawl(user: AuthUser, rawUrl: string) {
    const normalizedUrl = normalizeWebsiteUrl(rawUrl)
    const { job, created } = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${user.id}|${normalizedUrl}`}))`
      const existing = await tx.profileCrawlJob.findFirst({
        where: { userId: user.id, normalizedUrl, status: { in: ['PENDING', 'RUNNING'] } },
      })
      if (existing) return { job: existing, created: false }
      const job = await tx.profileCrawlJob.create({ data: { userId: user.id, normalizedUrl } })
      return { job, created: true }
    })
    if (created) await this.crawlQueue.add(job.id)
    return { jobId: job.id, status: job.status, url: normalizedUrl, reused: !created }
  }

  async getCrawl(user: AuthUser, jobId: string) {
    const job = await prisma.profileCrawlJob.findFirst({ where: { id: jobId, userId: user.id } })
    if (!job) throw new NotFoundException('Website analysis not found')
    return {
      jobId: job.id,
      url: job.normalizedUrl,
      status: job.status,
      result: job.result,
      error: job.error,
      mocked: true,
    }
  }

  list(user: AuthUser) {
    return prisma.searchProfile.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } })
  }

  async get(user: AuthUser, id: string) {
    const profile = await prisma.searchProfile.findFirst({ where: { id, userId: user.id } })
    if (!profile) throw new NotFoundException('Search profile not found')
    return profile
  }

  create(user: AuthUser, dto: CreateSearchProfileDto) {
    return prisma.searchProfile.create({
      data: {
        userId: user.id,
        name: dto.name.trim(),
        websiteUrl: dto.websiteUrl ? normalizeWebsiteUrl(dto.websiteUrl) : null,
        summary: dto.summary?.trim() || null,
        keywords: cleanList(dto.keywords),
        subreddits: normalizeTerms(dto.subreddits),
        exclusions: cleanList(dto.exclusions),
        platforms: [...new Set(dto.platforms)],
        active: dto.active ?? true,
      },
    })
  }

  async update(user: AuthUser, id: string, dto: UpdateSearchProfileDto) {
    await this.get(user, id)
    return prisma.searchProfile.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.websiteUrl !== undefined
          ? { websiteUrl: dto.websiteUrl ? normalizeWebsiteUrl(dto.websiteUrl) : null }
          : {}),
        ...(dto.summary !== undefined ? { summary: dto.summary.trim() || null } : {}),
        ...(dto.keywords !== undefined ? { keywords: cleanList(dto.keywords) } : {}),
        ...(dto.subreddits !== undefined ? { subreddits: normalizeTerms(dto.subreddits) } : {}),
        ...(dto.exclusions !== undefined ? { exclusions: cleanList(dto.exclusions) } : {}),
        ...(dto.platforms !== undefined ? { platforms: [...new Set(dto.platforms)] } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
    })
  }

  async remove(user: AuthUser, id: string) {
    await this.get(user, id)
    await prisma.searchProfile.delete({ where: { id } })
    return { deleted: true }
  }
}
