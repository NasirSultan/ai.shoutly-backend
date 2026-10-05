import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma } from '@prisma/client'
import axios from 'axios'
import { diffLines } from 'diff'
import OpenAI from 'openai'
import { prisma } from '../lib/prisma'
import { AiUsageLogService } from '../ai-usage/ai-usage-log.service'
import { RedisService } from '../common/redis/redis.service'
import {
  parseAnalysis,
  readTargetAudiences,
  sameWebsite,
  TARGET_AUDIENCE_COUNT,
  toOrigin,
  WebsiteAnalysis,
} from './website-watcher.util'

const TAVILY_EXTRACT_URL = 'https://api.tavily.com/extract'
const CHAT_MODEL = 'deepseek-chat'
const CONTENT_CHAR_LIMIT = 8000
// Successful checks per user per UTC day. Admins have no limit.
const DAILY_CHECK_LIMIT = 1

const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com',
})

interface RequestUser {
  id: string
  role: string
}

@Injectable()
export class WebsiteWatcherService {
  private readonly logger = new Logger(WebsiteWatcherService.name)

  constructor(
    private readonly configService: ConfigService,
    private readonly aiUsageLogService: AiUsageLogService,
    private readonly redisService: RedisService,
  ) {}

  // The page's starting state: which website the user may check, how many
  // checks are left today, and the last saved result for it.
  async getStatus(requestUser: RequestUser) {
    const isAdmin = requestUser.role === 'SUPERADMIN'
    const user = await this.loadUser(requestUser.id)
    const website = user.watcherWebsite ?? toOrigin(user.website ?? '')

    const snapshot = website
      ? await prisma.websiteSnapshot.findUnique({ where: { userId_url: { userId: user.id, url: website } } })
      : null

    return {
      website,
      isLocked: !isAdmin && !!user.watcherWebsite,
      isAdmin,
      dailyLimit: isAdmin ? null : DAILY_CHECK_LIMIT,
      checksLeftToday: isAdmin ? null : await this.checksLeftToday(user.id),
      lastCheck: snapshot
        ? {
            url: snapshot.url,
            summary: snapshot.summary,
            targetAudiences: readTargetAudiences(snapshot.audience),
            lastChangedAt: snapshot.lastChangedAt,
            lastCheckedAt: snapshot.lastCheckedAt ?? snapshot.updatedAt,
          }
        : null,
    }
  }

  async checkForChanges(requestUser: RequestUser, rawUrl?: string) {
    const apiKey = this.configService.get<string>('TAVILY_API_KEY')
    if (!apiKey) throw new BadGatewayException('TAVILY_API_KEY is not configured')

    const isAdmin = requestUser.role === 'SUPERADMIN'
    const user = await this.loadUser(requestUser.id)
    const url = this.resolveWebsite(user, rawUrl, isAdmin)

    if (!isAdmin && (await this.checksLeftToday(user.id)) === 0) {
      throw new HttpException(
        DAILY_CHECK_LIMIT === 1
          ? "You've already checked your website today. Try again tomorrow."
          : `You've used all ${DAILY_CHECK_LIMIT} website checks for today. Try again tomorrow.`,
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }

    const currentContent = await this.extractContent(url, apiKey)

    // Lock the website only after it was read successfully, so a typo or an
    // unreachable address doesn't become the user's website forever.
    if (!isAdmin && !user.watcherWebsite) {
      await prisma.user.update({ where: { id: user.id }, data: { watcherWebsite: url } })
    }

    const snapshot = await prisma.websiteSnapshot.findUnique({
      where: { userId_url: { userId: user.id, url } },
    })
    const checkedAt = new Date()
    const result = snapshot
      ? await this.compareWithSnapshot(snapshot, currentContent, checkedAt)
      : await this.saveFirstSnapshot(user.id, url, currentContent, checkedAt)

    if (!isAdmin) await this.recordCheck(user.id)

    return {
      url,
      checkedAt,
      ...result,
      checksLeftToday: isAdmin ? null : await this.checksLeftToday(user.id),
    }
  }

  // Admin only: set or clear the website a user is allowed to check.
  async setUserWebsite(userId: string, rawWebsite?: string | null) {
    const website = rawWebsite ? toOrigin(rawWebsite) : null
    if (rawWebsite && !website) {
      throw new BadRequestException('Enter a valid website address, for example https://mybusiness.com.')
    }
    const exists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
    if (!exists) throw new NotFoundException(`User ${userId} not found`)

    const user = await prisma.user.update({
      where: { id: userId },
      data: { watcherWebsite: website },
      select: { id: true, email: true, watcherWebsite: true },
    })
    return { userId: user.id, email: user.email, website: user.watcherWebsite }
  }

  private async loadUser(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, website: true, watcherWebsite: true },
    })
    if (!user) throw new NotFoundException('User not found')
    return user
  }

  // Which website this request may check:
  // - admins: any website (the one sent, else their own)
  // - users with a locked or profile website: only that one
  // - users without one: the one they send, which then becomes theirs
  private resolveWebsite(
    user: { website: string | null; watcherWebsite: string | null },
    rawUrl: string | undefined,
    isAdmin: boolean,
  ) {
    const requested = rawUrl?.trim() ? toOrigin(rawUrl) : null
    if (rawUrl?.trim() && !requested) {
      throw new BadRequestException('Enter a valid website address, for example https://mybusiness.com.')
    }

    const ownWebsite = user.watcherWebsite ?? toOrigin(user.website ?? '')

    if (isAdmin) {
      const url = requested ?? ownWebsite
      if (!url) throw new BadRequestException('Enter a website to check.')
      return url
    }

    if (ownWebsite) {
      if (requested && !sameWebsite(requested, ownWebsite)) {
        throw new ForbiddenException(`You can only check your own website: ${ownWebsite}`)
      }
      return ownWebsite
    }

    if (!requested) throw new BadRequestException('Enter your website to check.')
    return requested
  }

  private async saveFirstSnapshot(userId: string, url: string, content: string, checkedAt: Date) {
    const analysis = await this.analyze(content)
    await prisma.websiteSnapshot.create({
      data: {
        userId,
        url,
        content,
        summary: analysis.summary,
        audience: analysis.targetAudiences,
        lastChangedAt: checkedAt,
        lastCheckedAt: checkedAt,
      },
    })
    return {
      status: 'first_check' as const,
      message: 'No previous snapshot found. Baseline saved for future comparisons.',
      changeSummary: null,
      added: [] as string[],
      removed: [] as string[],
      summary: analysis.summary,
      targetAudiences: analysis.targetAudiences,
      lastChangedAt: checkedAt,
      previousCheckedAt: null,
    }
  }

  private async compareWithSnapshot(
    snapshot: {
      id: string
      content: string
      summary: string | null
      audience: Prisma.JsonValue
      lastChangedAt: Date | null
      lastCheckedAt: Date | null
      updatedAt: Date
    },
    content: string,
    checkedAt: Date,
  ) {
    const previousCheckedAt = snapshot.lastCheckedAt ?? snapshot.updatedAt
    const hasChanged = snapshot.content !== content

    if (!hasChanged) {
      // Nothing changed: reuse the saved analysis instead of paying for a new
      // one. Only a snapshot saved before analyses were stored gets one now.
      let summary = snapshot.summary
      let targetAudiences = readTargetAudiences(snapshot.audience)
      if (!summary || !targetAudiences) {
        const analysis = await this.analyze(content)
        summary = analysis.summary
        targetAudiences = analysis.targetAudiences
      }
      await prisma.websiteSnapshot.update({
        where: { id: snapshot.id },
        data: { summary, audience: targetAudiences, lastCheckedAt: checkedAt },
      })
      return {
        status: 'unchanged' as const,
        message: 'No changes found.',
        changeSummary: null,
        added: [] as string[],
        removed: [] as string[],
        summary,
        targetAudiences,
        lastChangedAt: snapshot.lastChangedAt,
        previousCheckedAt,
      }
    }

    const diff = this.buildLineDiff(snapshot.content, content)
    const analysis = await this.analyze(content, diff)
    await prisma.websiteSnapshot.update({
      where: { id: snapshot.id },
      data: {
        content,
        summary: analysis.summary,
        audience: analysis.targetAudiences,
        lastChangedAt: checkedAt,
        lastCheckedAt: checkedAt,
      },
    })
    return {
      status: 'changed' as const,
      message: 'Changes detected since the last check.',
      changeSummary: analysis.changeSummary,
      ...diff,
      summary: analysis.summary,
      targetAudiences: analysis.targetAudiences,
      lastChangedAt: checkedAt,
      previousCheckedAt,
    }
  }

  // One DeepSeek call returns what the website is, the 4 audiences to target
  // and, when the page changed, a summary of the change.
  private async analyze(content: string, diff?: { added: string[]; removed: string[] }): Promise<WebsiteAnalysis> {
    const changePart = diff
      ? `\n\nThe website changed since the last check.\nLines added:\n${diff.added.join('\n').slice(0, 3000) || '(none)'}\n\nLines removed:\n${diff.removed.join('\n').slice(0, 3000) || '(none)'}`
      : ''

    const prompt = `You analyse a business's website so its social media posts can target the right audiences.

Website content:
${content.slice(0, CONTENT_CHAR_LIMIT)}${changePart}

Reply with JSON only, in this exact shape:
{
  "summary": "2-4 sentences in clear English: what this business is and what it offers",
  "targetAudiences": ["exactly ${TARGET_AUDIENCE_COUNT} audience names"]${diff ? ',\n  "changeSummary": "2-4 sentences on what actually changed on the website"' : ''}
}

Rules for targetAudiences:
- Exactly ${TARGET_AUDIENCE_COUNT} names, most valuable first.
- Each name is tied to one service or product this website offers, and says who wants it.
- Each name is short (at most 8 words) and starts with who they are, e.g. "Businesses who want daily auto-posting", "Businesses who want their logo on every post", "People who want personal training", "Parents looking for weekend kids' classes".
- Base everything on the website content above.`

    const step = diff ? 'website_watcher_update_analysis' : 'website_watcher_analysis'
    let raw: string
    try {
      const completion = await deepseek.chat.completions.create({
        model: CHAT_MODEL,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0,
        max_tokens: 1200,
      })
      this.aiUsageLogService.logText({
        userId: null,
        provider: 'DEEPSEEK',
        model: CHAT_MODEL,
        operation: 'TEXT_GENERATION',
        promptTokens: completion.usage?.prompt_tokens ?? 0,
        completionTokens: completion.usage?.completion_tokens ?? 0,
        metadata: { step },
      })
      raw = completion.choices[0]?.message?.content ?? ''
    } catch (error: any) {
      throw new BadGatewayException(error.message || 'DeepSeek request failed')
    }

    const analysis = parseAnalysis(raw, !!diff)
    if (!analysis) {
      this.logger.warn(`[${step}] DeepSeek returned unusable JSON: ${raw.slice(0, 200)}`)
      throw new BadGatewayException('The website analysis could not be generated. Please try again.')
    }
    return analysis
  }

  private dailyKey(userId: string) {
    return `watcher:checks:${userId}:${new Date().toISOString().slice(0, 10)}`
  }

  // Fails open: if Redis is unavailable the check is allowed rather than
  // blocking every user.
  private async checksLeftToday(userId: string) {
    try {
      const used = Number(await this.redisService.getClient().get(this.dailyKey(userId))) || 0
      return Math.max(0, DAILY_CHECK_LIMIT - used)
    } catch (err) {
      this.logger.warn(`Daily check counter unavailable: ${(err as Error).message}`)
      return DAILY_CHECK_LIMIT
    }
  }

  // Counted after a check succeeds, so failed checks don't use up the limit.
  private async recordCheck(userId: string) {
    try {
      const client = this.redisService.getClient()
      const key = this.dailyKey(userId)
      await client.incr(key)
      await client.expire(key, 2 * 24 * 60 * 60)
    } catch (err) {
      this.logger.warn(`Daily check counter unavailable: ${(err as Error).message}`)
    }
  }

  private buildLineDiff(oldContent: string, newContent: string) {
    const changes = diffLines(oldContent, newContent)
    const added: string[] = []
    const removed: string[] = []

    for (const change of changes) {
      const lines = change.value.split('\n').filter((line) => line.length > 0)
      if (change.added) added.push(...lines)
      else if (change.removed) removed.push(...lines)
    }

    return { added, removed }
  }

  private async extractContent(url: string, apiKey: string) {
    try {
      const response = await axios.post(
        TAVILY_EXTRACT_URL,
        { api_key: apiKey, urls: [url] },
        { headers: { 'Content-Type': 'application/json' } },
      )

      const result = response.data?.results?.[0]
      if (!result?.raw_content) {
        const failure = response.data?.failed_results?.[0]
        throw new BadGatewayException(failure?.error || 'Tavily could not extract content from this URL')
      }

      return result.raw_content as string
    } catch (error: any) {
      if (error instanceof BadGatewayException) throw error
      const message = error.response?.data?.detail?.error || error.response?.data?.message || error.message
      throw new BadGatewayException(message || 'Tavily API request failed')
    }
  }
}
