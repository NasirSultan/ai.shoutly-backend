import { BadGatewayException, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import axios from 'axios'
import { diffLines } from 'diff'
import OpenAI from 'openai'
import { prisma } from '../lib/prisma'
import { AiUsageLogService } from '../ai-usage/ai-usage-log.service'

const TAVILY_EXTRACT_URL = 'https://api.tavily.com/extract'
const CHAT_MODEL = 'deepseek-chat'
const CONTENT_CHAR_LIMIT = 8000

const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com',
})

@Injectable()
export class WebsiteWatcherService {
  constructor(
    private readonly configService: ConfigService,
    private readonly aiUsageLogService: AiUsageLogService,
  ) {}

  async checkForChanges(url: string) {
    const apiKey = this.configService.get<string>('TAVILY_API_KEY')
    if (!apiKey) throw new BadGatewayException('TAVILY_API_KEY is not configured')

    const currentContent = await this.extractContent(url, apiKey)
    const previousSnapshot = await prisma.websiteSnapshot.findUnique({ where: { url } })
    const checkedAt = new Date()

    if (!previousSnapshot) {
      await prisma.websiteSnapshot.create({ data: { url, content: currentContent } })
      const summary = await this.summarizeContent(currentContent)
      return {
        url,
        checkedAt,
        status: 'first_check' as const,
        message: 'No previous snapshot found. Baseline saved for future comparisons.',
        summary,
      }
    }

    const hasChanged = previousSnapshot.content !== currentContent
    const diff = hasChanged
      ? this.buildLineDiff(previousSnapshot.content, currentContent)
      : { added: [], removed: [] }
    const summary = hasChanged
      ? await this.summarizeUpdate(diff.added, diff.removed)
      : 'No new updates found since the last check.'

    await prisma.websiteSnapshot.update({ where: { url }, data: { content: currentContent } })

    return {
      url,
      checkedAt,
      status: hasChanged ? ('changed' as const) : ('unchanged' as const),
      message: hasChanged ? 'Changes detected since the last check.' : 'No changes found.',
      summary,
      ...diff,
    }
  }

  private async summarizeContent(content: string) {
    const prompt = `Summarize the following webpage content in clear English, in 3-5 sentences:\n\n${content.slice(0, CONTENT_CHAR_LIMIT)}`
    return this.askDeepSeek(prompt, 'website_watcher_first_check_summary')
  }

  private async summarizeUpdate(added: string[], removed: string[]) {
    const addedText = added.join('\n').slice(0, CONTENT_CHAR_LIMIT) || '(none)'
    const removedText = removed.join('\n').slice(0, CONTENT_CHAR_LIMIT) || '(none)'
    const prompt = `A webpage changed since the last check. Lines added:\n${addedText}\n\nLines removed:\n${removedText}\n\nIn clear English, write a short summary (2-4 sentences) of what actually changed on the page.`
    return this.askDeepSeek(prompt, 'website_watcher_update_summary')
  }

  private async askDeepSeek(prompt: string, step: string) {
    try {
      const completion = await deepseek.chat.completions.create({
        model: CHAT_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: 400,
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

      return (completion.choices[0]?.message?.content ?? '').trim()
    } catch (error: any) {
      throw new BadGatewayException(error.message || 'DeepSeek request failed')
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
