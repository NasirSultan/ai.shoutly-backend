import { BadGatewayException, BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { Prisma, SearchProfile } from '@prisma/client'
import { createHash } from 'crypto'
import OpenAI from 'openai'
import { prisma } from '../lib/prisma'
import { AiUsageLogService } from '../ai-usage/ai-usage-log.service'
import { RedisService } from '../common/redis/redis.service'
import { MonitoringService } from '../monitoring/monitoring.service'
import { readKeywords, toOrigin, USER_KEYWORD_MAX } from '../website-watcher/website-watcher.util'
import { LeadFinderUser, assertLeadFinderAccess } from '../lead-finder/lead-finder-access'
import { normalizeTerms } from '../lead-finder/query-key'
import { DailySearchState, readDailySearch } from '../lead-finder/daily-search'
import { CreateSearchProfileDto, UpdateSearchProfileDto } from './dto/search-profile.dto'

const CHAT_MODEL = 'deepseek-chat'
const MAX_PROFILES_PER_USER = 10
// Suggestions only change when the user's analysis or keywords change.
const SUGGESTION_CACHE_SECONDS = 24 * 60 * 60
const SUBREDDIT_NAME = /^[A-Za-z0-9_]{2,21}$/
// Words that also show up in real buyers' posts ("a free app", "need help"),
// so they are never suggested as exclusions even if the AI proposes them.
const TOO_BROAD_EXCLUSIONS = new Set(['free', 'cheap', 'help', 'need', 'hire', 'hiring', 'looking', 'app', 'website', 'job'])
// The automatic profile searches for a few AI buyer phrases plus the user's
// own keywords. Facebook only searches the first few, so buyer phrases go first.
const AUTO_BUYER_PHRASES = 4
const AUTO_SEARCH_KEYWORDS = 12
// Used when the AI can't suggest exclusions: people selling, not buying.
const DEFAULT_EXCLUSIONS = ['[for hire]', 'looking for work', 'open to work']

/** What the AI suggests from the Website Analysis (cached per input). */
interface SearchSuggestions {
  suggestedName: string
  /** Phrases a buyer would write */
  keywords: string[]
  subreddits: string[]
  exclusions: string[]
}

/** GET /search-profiles/auto: the user's automatic profile, or what is missing to build it. */
export interface AutoProfileState {
  /** true = there is a profile and "Get leads" can run */
  ready: boolean
  /** What the user still needs to set up. Keywords are required, industry only helps. */
  missing: ('keywords' | 'industry')[]
  /** "Industry › Sub-industry" from the dashboard settings */
  industry: string | null
  /** The user's own Website Analysis keywords (what they sell) */
  keywords: string[]
  /** AI phrases a buyer would write, searched as well as the keywords */
  buyerPhrases: string[]
  profile: SearchProfile | null
  /** Admins have no daily limit */
  isAdmin: boolean
  /** When the last successful "Get leads" finished */
  lastSearchedAt: string | null
  /** One successful search a day; null = no limit (admin) */
  searchesLeftToday: number | null
}

const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com',
})

export interface ProfileSuggestions {
  /** false = the user hasn't run Website Analysis yet, so there is nothing to suggest from */
  analysed: boolean
  source: 'WEBSITE' | 'DESCRIPTION' | null
  summary: string | null
  /** The user's own Website Analysis keywords (what they offer) */
  serviceKeywords: string[]
  suggestedName: string | null
  /** Phrases buyers use when they want to hire for those services */
  keywords: string[]
  subreddits: string[]
  exclusions: string[]
}

/** Keeps the user's own wording for display, but trims, drops blanks and duplicates. */
function cleanList(list: string[] | undefined, max = 20, maxLength = 80): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of list ?? []) {
    const value = String(item).trim().replace(/\s+/g, ' ').slice(0, maxLength)
    const key = value.toLowerCase()
    if (value && !seen.has(key)) {
      seen.add(key)
      out.push(value)
    }
    if (out.length >= max) break
  }
  return out
}

@Injectable()
export class SearchProfilesService {
  private readonly logger = new Logger(SearchProfilesService.name)

  // MonitoringService comes from the global MonitoringCoreModule.
  constructor(
    private readonly aiUsageLogService: AiUsageLogService,
    private readonly redisService: RedisService,
    private readonly monitoring: MonitoringService,
  ) {}

  /**
   * Profile suggestions from the user's own Website Analysis (saved keywords
   * plus the website or business-description summary). One DeepSeek call turns
   * "what I offer" into what buyers write, plus subreddits and words to exclude.
   */
  async getSuggestions(user: LeadFinderUser): Promise<ProfileSuggestions> {
    await assertLeadFinderAccess(user)
    const [analysis, industry] = await Promise.all([this.loadWebsiteAnalysis(user.id), this.loadIndustry(user.id)])
    if (!analysis) {
      return {
        analysed: false,
        source: null,
        summary: null,
        serviceKeywords: [],
        suggestedName: null,
        keywords: [],
        subreddits: [],
        exclusions: [],
      }
    }

    const ai = await this.cachedSuggestions(user.id, analysis.summary, analysis.keywords, industry)
    return {
      analysed: true,
      source: analysis.source,
      summary: analysis.summary,
      serviceKeywords: analysis.keywords,
      ...ai,
    }
  }

  /**
   * The user's one automatic profile, built from data they already have:
   * their Website Analysis keywords (what they sell, used for scoring) and
   * their dashboard industry. What is searched is those keywords plus a few
   * AI buyer phrases. Called each time Lead Finder opens, so a change to the
   * keywords or industry is picked up without the user doing anything.
   */
  async syncAutoProfile(user: LeadFinderUser): Promise<AutoProfileState> {
    await assertLeadFinderAccess(user)
    const isAdmin = user.role === 'SUPERADMIN'
    const [analysis, industry, daily] = await Promise.all([
      this.loadWebsiteAnalysis(user.id),
      this.loadIndustry(user.id),
      readDailySearch(this.redisService, user.id, isAdmin),
    ])
    const limits = { isAdmin, ...daily }
    const missing: AutoProfileState['missing'] = []
    if (!analysis) missing.push('keywords')
    if (!industry) missing.push('industry')

    const existing = await prisma.searchProfile.findFirst({ where: { userId: user.id, auto: true } })
    if (!analysis) {
      return { ready: false, missing, industry, keywords: [], buyerPhrases: [], profile: null, ...limits }
    }

    const topicKeywords = analysis.keywords
    // AI phrases are a bonus: if the AI is down, search the user's own keywords.
    let ai: SearchSuggestions | null = null
    try {
      ai = await this.cachedSuggestions(user.id, analysis.summary, topicKeywords, industry)
    } catch {
      ai = null
    }

    const sameTopic =
      !!existing &&
      existing.industry === industry &&
      existing.topicKeywords.join('|') === topicKeywords.join('|')
    // A failed AI call must not replace a good profile with a weaker one.
    if (!ai && existing && sameTopic) return this.toAutoState(existing, missing, limits)

    const buyerPhrases = (ai?.keywords ?? [])
      .filter((k) => !topicKeywords.includes(k))
      .slice(0, AUTO_BUYER_PHRASES)
    const data = {
      name: (industry ? `${industry} leads` : 'My leads').slice(0, 80),
      summary: analysis.summary?.slice(0, 500) ?? null,
      keywords: cleanList([...buyerPhrases, ...topicKeywords], AUTO_SEARCH_KEYWORDS),
      subreddits: ai?.subreddits ?? [],
      exclusions: ai?.exclusions.length ? ai.exclusions : DEFAULT_EXCLUSIONS,
      platforms: ['REDDIT', 'FACEBOOK'] as SearchProfile['platforms'],
      topicKeywords,
      industry,
    }

    if (existing) {
      const unchanged = (['name', 'summary', 'keywords', 'subreddits', 'exclusions', 'platforms', 'topicKeywords', 'industry'] as const).every(
        (k) => JSON.stringify(existing[k]) === JSON.stringify(data[k]),
      )
      const profile = unchanged ? existing : await prisma.searchProfile.update({ where: { id: existing.id }, data })
      return this.toAutoState(profile, missing, limits)
    }

    try {
      const profile = await prisma.searchProfile.create({ data: { userId: user.id, auto: true, ...data } })
      return this.toAutoState(profile, missing, limits)
    } catch (err) {
      // Two tabs opened at once: the unique index let only one create it.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const profile = await prisma.searchProfile.findFirst({ where: { userId: user.id, auto: true } })
        if (profile) return this.toAutoState(profile, missing, limits)
      }
      throw err
    }
  }

  private toAutoState(
    profile: SearchProfile,
    missing: AutoProfileState['missing'],
    limits: DailySearchState & { isAdmin: boolean },
  ): AutoProfileState {
    return {
      ...limits,
      ready: true,
      missing,
      industry: profile.industry,
      keywords: profile.topicKeywords,
      buyerPhrases: profile.keywords.filter((k) => !profile.topicKeywords.includes(k)),
      profile,
    }
  }

  /** AI buyer phrases, subreddits and exclusions, cached until the inputs change. */
  private async cachedSuggestions(userId: string, summary: string | null, keywords: string[], industry: string | null) {
    const cacheKey = `lead-finder:suggestions:${userId}:${createHash('sha1')
      .update(JSON.stringify([summary, keywords, industry]))
      .digest('hex')}`
    const cached = await this.readCache(cacheKey)
    if (cached) return cached
    const ai = await this.suggestSearch(summary, keywords, industry)
    await this.writeCache(cacheKey, ai)
    return ai
  }

  /** "Industry › Sub-industry" from the dashboard settings, or null when not chosen. */
  private async loadIndustry(userId: string): Promise<string | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        industry: { select: { name: true } },
        subIndustry: { select: { name: true, industry: { select: { name: true } } } },
      },
    })
    const industryName = user?.industry?.name ?? user?.subIndustry?.industry?.name
    const parts = [industryName, user?.subIndustry?.name].map((p) => p?.trim()).filter(Boolean)
    return parts.length ? [...new Set(parts)].join(' › ') : null
  }

  list(user: LeadFinderUser) {
    return prisma.searchProfile.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } })
  }

  async get(user: LeadFinderUser, id: string) {
    const profile = await prisma.searchProfile.findFirst({ where: { id, userId: user.id } })
    if (!profile) throw new NotFoundException('Search profile not found')
    return profile
  }

  async create(user: LeadFinderUser, dto: CreateSearchProfileDto) {
    await assertLeadFinderAccess(user)
    const count = await prisma.searchProfile.count({ where: { userId: user.id } })
    if (count >= MAX_PROFILES_PER_USER) {
      throw new BadRequestException(`You can have up to ${MAX_PROFILES_PER_USER} search profiles.`)
    }
    return prisma.searchProfile.create({
      data: {
        userId: user.id,
        name: dto.name.trim(),
        summary: dto.summary?.trim() || null,
        keywords: cleanList(dto.keywords, 10),
        subreddits: normalizeTerms(dto.subreddits),
        exclusions: cleanList(dto.exclusions, 20, 50),
        platforms: [...new Set(dto.platforms)],
        active: dto.active ?? true,
      },
    })
  }

  async update(user: LeadFinderUser, id: string, dto: UpdateSearchProfileDto) {
    await this.get(user, id)
    return prisma.searchProfile.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.summary !== undefined ? { summary: dto.summary.trim() || null } : {}),
        ...(dto.keywords !== undefined ? { keywords: cleanList(dto.keywords, 10) } : {}),
        ...(dto.subreddits !== undefined ? { subreddits: normalizeTerms(dto.subreddits) } : {}),
        ...(dto.exclusions !== undefined ? { exclusions: cleanList(dto.exclusions, 20, 50) } : {}),
        ...(dto.platforms !== undefined ? { platforms: [...new Set(dto.platforms)] } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
    })
  }

  async remove(user: LeadFinderUser, id: string) {
    await this.get(user, id)
    await prisma.searchProfile.delete({ where: { id } })
    return { deleted: true }
  }

  /** The same data the Website Analysis page shows: the user's keywords and the matching summary. */
  private async loadWebsiteAnalysis(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { watcherKeywords: true, watcherSource: true, watcherWebsite: true, website: true },
    })
    if (!user) throw new NotFoundException('User not found')

    const website = user.watcherWebsite ?? toOrigin(user.website ?? '')
    const [snapshot, described] = await Promise.all([
      website
        ? prisma.websiteSnapshot.findUnique({
            where: { userId_url: { userId, url: website } },
            select: { summary: true, keywords: true },
          })
        : null,
      prisma.businessDescription.findUnique({ where: { userId }, select: { summary: true, keywords: true } }),
    ])

    const useDescription = user.watcherSource === 'DESCRIPTION' || (!snapshot && !!described)
    const saved = useDescription ? described : snapshot
    const keywords =
      readKeywords(user.watcherKeywords, USER_KEYWORD_MAX) ?? readKeywords(saved?.keywords, USER_KEYWORD_MAX)
    if (!keywords) return null
    return {
      source: (useDescription ? 'DESCRIPTION' : 'WEBSITE') as 'WEBSITE' | 'DESCRIPTION',
      summary: saved?.summary ?? null,
      keywords,
    }
  }

  private async suggestSearch(
    summary: string | null,
    serviceKeywords: string[],
    industry: string | null,
  ): Promise<SearchSuggestions> {
    const prompt = `You help a business find people on Reddit and Facebook who want to hire or buy what it offers.

Industry: ${industry ?? '(not set)'}
Business summary: ${summary ?? '(none)'}
What it offers (service keywords): ${serviceKeywords.join('; ')}

Return ONLY a JSON object:
{
  "name": "short profile name, e.g. \\"Web development leads\\"",
  "keywords": ["4-6 short search phrases a BUYER would write, e.g. \\"hiring web developer\\", \\"need a website built\\", \\"looking for seo agency\\""],
  "subreddits": ["4-6 real, active subreddit names (no r/ prefix) where people post requests to hire this kind of work, e.g. forhire, smallbusiness"],
  "exclusions": ["3-6 specific phrases that only appear in posts to skip (people selling their own services or looking for a job), e.g. \\"[for hire]\\", \\"looking for work\\", \\"open to work\\". Never common single words like \\"free\\" or \\"cheap\\", which also appear in real buyers' posts"]
}
Rules: phrases in plain lowercase English, each under 6 words. Never include the business's own name.`

    let raw: string
    try {
      const completion = await deepseek.chat.completions.create({
        model: CHAT_MODEL,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0,
        max_tokens: 600,
      })
      this.aiUsageLogService.logText({
        userId: null,
        provider: 'DEEPSEEK',
        model: CHAT_MODEL,
        operation: 'TEXT_GENERATION',
        promptTokens: completion.usage?.prompt_tokens ?? 0,
        completionTokens: completion.usage?.completion_tokens ?? 0,
        metadata: { step: 'lead_finder_profile_suggestions' },
      })
      raw = completion.choices[0]?.message?.content ?? ''
    } catch (error: any) {
      void this.monitoring.recordServiceError('deepseek')
      // Provider details stay in the server log; the user gets a plain message.
      this.logger.error(`DeepSeek profile suggestions failed: ${error?.message ?? error}`)
      throw new BadGatewayException("Couldn't build suggestions right now. Fill in the profile by hand or try again later.")
    }

    let data: any = null
    try {
      data = JSON.parse(raw)
    } catch {
      this.logger.warn(`DeepSeek returned unusable profile suggestions: ${raw.slice(0, 200)}`)
    }
    const keywords = cleanList(Array.isArray(data?.keywords) ? data.keywords : [], 6, 60).map((k) => k.toLowerCase())
    return {
      suggestedName: typeof data?.name === 'string' && data.name.trim() ? data.name.trim().slice(0, 80) : 'My leads',
      // If the AI gave nothing usable, fall back to the user's own keywords.
      keywords: keywords.length ? keywords : serviceKeywords.slice(0, 6),
      subreddits: normalizeTerms(Array.isArray(data?.subreddits) ? data.subreddits.map(String) : [])
        .filter((s) => SUBREDDIT_NAME.test(s))
        .slice(0, 6),
      exclusions: cleanList(Array.isArray(data?.exclusions) ? data.exclusions : [], 6, 50)
        .map((e) => e.toLowerCase())
        .filter((e) => !TOO_BROAD_EXCLUSIONS.has(e)),
    }
  }

  private async readCache(key: string): Promise<SearchSuggestions | null> {
    try {
      const value = await this.redisService.getClient().get(key)
      return value ? (JSON.parse(String(value)) as SearchSuggestions) : null
    } catch {
      return null
    }
  }

  private async writeCache(key: string, value: SearchSuggestions) {
    try {
      await this.redisService.getClient().set(key, JSON.stringify(value), { EX: SUGGESTION_CACHE_SECONDS })
    } catch (err) {
      this.logger.warn(`Suggestion cache unavailable: ${(err as Error).message}`)
    }
  }
}
