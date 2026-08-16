import { Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common'
import OpenAI from 'openai'
import { PrismaService } from '../lib/prisma.service'
import { UploadDocumentDto } from './dto/upload-document.dto'
import { BulkUploadDto } from './dto/bulk-upload.dto'
import { ChatQueryDto } from './dto/chat-query.dto'
import { AiUsageLogService } from '../ai-usage/ai-usage-log.service'
import { Cta } from './chatbot-flow.config'
import { RedisService } from '../common/redis/redis.service'
import { franc } from 'franc'
const searchStart = Date.now()
export interface AiUsageContext {
  userId?: string | null
}

export interface RagDocument {
  id: string
  title: string
  content: string
  metadata: Record<string, any>
  created_at: string
  updated_at: string
}

export interface RagDocumentWithScore extends RagDocument {
  similarity: number
}

export interface IndexResult {
  success: boolean
  id?: string
  title: string
  message: string
  error?: string
}

export interface BulkIndexResult {
  success: boolean
  total: number
  indexed: number
  failed: number
  results: IndexResult[]
  message: string
}

export interface ChatResponse {
  success: boolean
  query: string
  answer: string
  confidence: 'high' | 'medium' | 'low'
  retrievedAt: string
  cta: Cta | null
}

/**
 * Scans the retrieved top-K (same set used to build the answer) for the
 * first tagged link, rather than requiring rank #1 — similarity scores
 * cluster tightly (~0.68-0.73), so an untagged near-duplicate doc can
 * outrank a tagged one by a hair. No fallback CTA on untagged answers.
 */
function resolveCta(sources: RagDocumentWithScore[]): Cta | null {
  const tagged = sources.find((s) => s.metadata?.link)
  if (tagged) {
    return { label: tagged.metadata.linkLabel ?? tagged.title, url: tagged.metadata.link }
  }
  return null
}

interface QueryRewrite {
  language: string
  rewrittenQuery: string
}

const SUPPORT_EMAIL = 'hello@shoutlyai.com'

// OpenAI — embeddings only (text-embedding-3-small, 768-dim matches DB schema)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// DeepSeek — chat and stream via OpenAI-compatible SDK
const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com',
})
const CHAT_MODEL = 'deepseek-chat'

interface ChatTurn {
  query: string
  answer: string
}

const MAX_TURNS = 3 // last 3 exchanges = 6 messages
const SESSION_TTL_SECONDS = 30 * 60 // idle sessions expire after 30 min
const MAX_STORED_ANSWER_CHARS = 250 // caps what gets replayed as history — the full answer is still returned to the user this turn

/**
 * Redis-backed short-term chat history, keyed by sessionId. Survives
 * restarts and works across multiple server instances, unlike a plain
 * in-memory Map. TTL auto-evicts idle sessions instead of growing forever.
 */
class ConversationMemory {
  constructor(private readonly redis: RedisService) {}

  private key(sessionId: string): string {
    return `rag:session:${sessionId}`
  }

  async getHistory(sessionId?: string): Promise<ChatTurn[]> {
    if (!sessionId) return []
    const raw = await this.redis.getClient().get(this.key(sessionId))
    return raw ? JSON.parse(raw) : []
  }

  async addTurn(sessionId: string | undefined, query: string, answer: string): Promise<void> {
    if (!sessionId) return
    const turns = await this.getHistory(sessionId)
    const storedAnswer = answer.length > MAX_STORED_ANSWER_CHARS
      ? answer.slice(0, MAX_STORED_ANSWER_CHARS) + '…'
      : answer
    turns.push({ query, answer: storedAnswer })
    if (turns.length > MAX_TURNS) turns.shift()
    await this.redis.getClient().set(this.key(sessionId), JSON.stringify(turns), { EX: SESSION_TTL_SECONDS })
  }
}

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name)
  private readonly conversationMemory: ConversationMemory

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiUsageLogService: AiUsageLogService,
    private readonly redis: RedisService,
  ) {
    this.conversationMemory = new ConversationMemory(this.redis)
  }

  async embedText(text: string, context?: AiUsageContext): Promise<number[]> {
    try {
      const response = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
        dimensions: 768,
      })

      this.aiUsageLogService.logText({
        userId: context?.userId,
        provider: 'OPENAI',
        model: 'text-embedding-3-small',
        operation: 'EMBEDDING',
        promptTokens: response.usage?.total_tokens ?? 0,
        completionTokens: 0,
      })

      const values = response.data[0]?.embedding
      if (!values || values.length === 0) throw new Error('Empty embedding returned')
      return values
    } catch (error: any) {
      throw new InternalServerErrorException(`Embedding failed: ${error.message}`)
    }
  }

  async indexDocument(dto: UploadDocumentDto, context?: AiUsageContext): Promise<IndexResult> {
    try {
      const embedding = await this.embedText(`${dto.title}\n${dto.content}`, context)
      const vectorStr = `[${embedding.join(',')}]`

      const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `INSERT INTO rag_documents (title, content, metadata, embedding, updated_at)
         VALUES ($1, $2, $3::jsonb, $4::vector, now())
         RETURNING id`,
        dto.title,
        dto.content,
        JSON.stringify(dto.metadata ?? {}),
        vectorStr,
      )

      if (!rows || rows.length === 0 || !rows[0].id) {
        return { success: false, title: dto.title, message: 'Insert returned no ID — document not saved' }
      }

      return { success: true, id: rows[0].id, title: dto.title, message: 'Document indexed successfully' }
    } catch (error: any) {
      return { success: false, title: dto.title, message: 'Failed to index document', error: error.message }
    }
  }

  async bulkIndexDocuments(dto: BulkUploadDto, context?: AiUsageContext): Promise<BulkIndexResult> {
    const results: IndexResult[] = []
    for (const doc of dto.documents) {
      results.push(await this.indexDocument(doc, context))
    }
    const indexed = results.filter((r) => r.success).length
    const failed = results.filter((r) => !r.success).length
    return {
      success: failed === 0,
      total: dto.documents.length,
      indexed,
      failed,
      results,
      message: failed === 0
        ? `All ${indexed} document(s) indexed successfully`
        : `${indexed} of ${dto.documents.length} indexed — ${failed} failed`,
    }
  }

  private normalizeQuery(query: string): string {
    return query.replace(/[-_/\\|]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
  }

 private isLikelyCleanEnglish(query: string): boolean {
  const text = query.trim()

  if (!text || text.length < 10) return false

  const detectedLanguage = franc(text, {
    minLength: 10,
  })

  return detectedLanguage === 'eng'
}

private async rewriteQuery(query: string): Promise<QueryRewrite> {
  const prompt = `Analyze the original user message.

Your job is to return two things:

1. Detect the language and script of the ORIGINAL message.
2. Rewrite the ORIGINAL message into clear English for RAG search.

Important rules:
- Do not assume Latin/ASCII text is English.
- Roman Urdu written with Latin letters is Roman Urdu, not English.
- Preserve the user's exact meaning and intent.
- Do not add information.
- rewrittenQuery must always be English.
- language must describe the language and script of the ORIGINAL message.
- The language value will be used to generate the final answer.

Examples:

User: "shoutly ai key bray main bta ho"
Result:
{"language":"Roman Urdu (Latin script)","rewrittenQuery":"Tell me about ShoutlyAI."}

User: "shoutly ai ke bare mein batao"
Result:
{"language":"Roman Urdu (Latin script)","rewrittenQuery":"Tell me about ShoutlyAI."}

User: "شوٹلی اے آئی کے بارے میں بتائیں"
Result:
{"language":"Urdu (Arabic script)","rewrittenQuery":"Tell me about ShoutlyAI."}

User: "What is ShoutlyAI?"
Result:
{"language":"English (Latin script)","rewrittenQuery":"What is ShoutlyAI?"}

Original user message:
"${query}"

Return JSON only:
{"language":"<original language and script>","rewrittenQuery":"<clear English query>"}`

  try {
    const completion = await deepseek.chat.completions.create({
      model: CHAT_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 150,
    })

    this.aiUsageLogService.logText({
      userId: null,
      provider: 'DEEPSEEK',
      model: CHAT_MODEL,
      operation: 'CHAT',
      promptTokens: completion.usage?.prompt_tokens ?? 0,
      completionTokens: completion.usage?.completion_tokens ?? 0,
      metadata: { step: 'query_rewrite' },
    })

    const raw = (completion.choices[0]?.message?.content ?? '').trim()
    const jsonMatch = raw.match(/\{[\s\S]*\}/)

    if (!jsonMatch) {
      throw new Error('No JSON in rewrite response')
    }

    const parsed: QueryRewrite = JSON.parse(jsonMatch[0])

    if (!parsed.language) {
      throw new Error('Empty language')
    }

    if (!parsed.rewrittenQuery) {
      throw new Error('Empty rewrittenQuery')
    }

    return {
      language: parsed.language,
      rewrittenQuery: parsed.rewrittenQuery.trim(),
    }
  } catch (error: any) {
    this.logger.warn(
      `Query rewrite failed, falling back to original query: ${error.message}`,
    )

    return {
      language: 'English (Latin script)',
      rewrittenQuery: query.trim(),
    }
  }
}

private async resolveQuery(query: string): Promise<QueryRewrite> {
  const normalizedQuery = query.trim()

  if (this.isLikelyCleanEnglish(normalizedQuery)) {
    return {
      language: 'English (Latin script)',
      rewrittenQuery: normalizedQuery,
    }
  }

  return this.rewriteQuery(normalizedQuery)
}

  /** Pure-ASCII text is very likely already clean English — non-ASCII always needs rewriteQuery for translation. */


  async searchSimilar(query: string, topK = 5, excludeCategories: string[] = [] ): Promise<RagDocumentWithScore[]> {
    const embedding = await this.embedText(this.normalizeQuery(query)) 
    const vectorStr = `[${embedding.join(',')}]`
    const limit = Math.max(1, Math.min(10, topK))

    const rows = await this.prisma.$queryRawUnsafe<
      Array<RagDocument & { similarity: number; metadata: string }>
    >(
      `SELECT
         id::text,
         title,
         content,
         metadata::text AS metadata,
         created_at::text,
         updated_at::text,
         1 - (embedding <=> $1::vector) AS similarity
       FROM rag_documents
       WHERE cardinality($3::text[]) = 0 OR NOT (COALESCE(metadata->>'category', '') = ANY($3::text[]))
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      vectorStr,
      limit,
      excludeCategories,
    )

    return rows.map((r) => ({
      ...r,
      metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata,
      similarity: Number(r.similarity),
    }))
  }

  async chat(dto: ChatQueryDto): Promise<ChatResponse> {
    const topK = dto.topK ?? 5
    this.logger.log(`[chat] query received: "${dto.query}"`)

    const [{ language, rewrittenQuery }, history] = await Promise.all([
      this.resolveQuery(dto.query),
      this.conversationMemory.getHistory(dto.sessionId),
    ])
    this.logger.log(`[chat] rewritten query: "${rewrittenQuery}" (detected language: ${language})`)

    const sources = await this.searchSimilar(rewrittenQuery, topK, ['greeting'])
    this.logger.log(
      `[chat] retrieved ${sources.length} chunk(s): ` +
        sources.map((s) => `"${s.title}" (similarity: ${s.similarity.toFixed(3)})`).join(', '),
    )

    const contextUsed = sources.length > 0
    const contextBlock = sources.map((s, i) => `[${i + 1}] "${s.title}"\n${s.content}`).join('\n\n---\n\n')

    const historyBlock = history.length > 0
      ? `Previous conversation (most recent last):\n${history.map((t) => `User: ${t.query}\nAssistant: ${t.answer}`).join('\n')}\n\n`
      : ''

    const prompt = `You are ShoutlyAI's support assistant. Never mention "context"/"documents" — answer naturally, first person.

${historyBlock}${contextUsed ? `Reference:\n${contextBlock}` : 'No reference material found for this question.'}

Question: ${dto.query}

Rules:
- Use the previous conversation (if any) to resolve follow-ups/pronouns (e.g. "it", "that plan") — don't ask the user to repeat themselves.
- Greeting/small talk → reply warmly as ShoutlyAI's assistant, no reference needed.
- Else: use ONLY the reference above, never invent facts.
- Reply only in ${language} — short, plain, human words, no em dashes (—).
- Answer ONLY what was asked. Skip unrequested extra details (e.g. don't mention payment methods unless asked about payment).
- Do NOT end with a generic closer like "What would you like to know?" or "How can I help?". Only ask a follow-up question if the user's own query is genuinely unclear or ambiguous.
- Keep it short overall. If comparing 2+ things (plans, platforms, steps, etc), ALWAYS use one bullet per item, each on its own line — never merge them into one sentence.
- About ShoutlyAI?
  - Yes, reference answers it → answer directly.
  - Yes, reference lacks it → name the missing topic, then tell them to email ${SUPPORT_EMAIL}.
  - No → say you don't have that info. No email.

JSON only:
{"answer":"<in ${language}>","confidence":"high|medium|low","contextUsed":<true|false>}`

    try {
      const completion = await deepseek.chat.completions.create({
        model: CHAT_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: 500,
      })

      this.aiUsageLogService.logText({
        userId: null,
        provider: 'DEEPSEEK',
        model: CHAT_MODEL,
        operation: 'CHAT',
        promptTokens: completion.usage?.prompt_tokens ?? 0,
        completionTokens: completion.usage?.completion_tokens ?? 0,
        metadata: { step: 'chat' },
      })

      const raw = (completion.choices[0]?.message?.content ?? '').trim()
      const jsonMatch = raw.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('No JSON in DeepSeek response')

      const parsed: { answer: string; confidence: 'high' | 'medium' | 'low'; contextUsed: boolean } =
        JSON.parse(jsonMatch[0])

      this.logger.log(`[chat] final answer (confidence: ${parsed.confidence}): "${parsed.answer}"`)

      // Fire-and-forget — don't make the user wait on a Redis write that only benefits future turns.
      this.conversationMemory
        .addTurn(dto.sessionId, dto.query, parsed.answer)
        .catch((err) => this.logger.warn(`[chat] failed to save session history: ${err.message}`))

      return {
        success: true,
        query: dto.query,
        answer: parsed.answer,
        confidence: parsed.confidence,
        retrievedAt: new Date().toISOString(),
        cta: resolveCta(sources),
      }
    } catch (error: any) {
      this.logger.error(`[chat] chat generation failed: ${error.message}`)
      throw new InternalServerErrorException(`Chat generation failed: ${error.message}`)
    }
  }

  async *streamChat(dto: ChatQueryDto): AsyncGenerator<string> {
    this.logger.log(`[streamChat] query received: "${dto.query}"`)

    const [{ language, rewrittenQuery }, history] = await Promise.all([
      this.resolveQuery(dto.query),
      this.conversationMemory.getHistory(dto.sessionId),
    ])
    this.logger.log(`[streamChat] rewritten query: "${rewrittenQuery}" (detected language: ${language})`)

    const sources = await this.searchSimilar(rewrittenQuery, dto.topK ?? 5, ['greeting'])
    const top2 = sources.slice(0, 2)
    this.logger.log(
      `[streamChat] retrieved ${sources.length} chunk(s), using top ${top2.length}: ` +
        top2.map((s) => `"${s.title}" (similarity: ${s.similarity.toFixed(3)})`).join(', '),
    )

    const contextBlock = top2.map((s, i) => `[${i + 1}] "${s.title}"\n${s.content}`).join('\n\n---\n\n')
    const historyBlock = history.length > 0
      ? `Previous conversation (most recent last):\n${history.map((t) => `User: ${t.query}\nAssistant: ${t.answer}`).join('\n')}\n\n`
      : ''

    const prompt = `You are ShoutlyAI's support assistant. Never mention "context"/"documents" — answer naturally, first person.

${historyBlock}Reference:
${contextBlock}

Question: ${dto.query}

Rules:
- Use the previous conversation (if any) to resolve follow-ups/pronouns (e.g. "it", "that plan") — don't ask the user to repeat themselves.
- Greeting/small talk → reply warmly as ShoutlyAI's assistant, no reference needed.
- Else: use ONLY the reference above, never invent facts.
- Reply only in ${language} — short, plain, human words, no em dashes (—).
- Answer ONLY what was asked. Skip unrequested extra details (e.g. don't mention payment methods unless asked about payment).
- Do NOT end with a generic closer like "What would you like to know?" or "How can I help?". Only ask a follow-up question if the user's own query is genuinely unclear or ambiguous.
- Keep it short overall. If comparing 2+ things (plans, platforms, steps, etc), ALWAYS use one bullet per item, each on its own line — never merge them into one sentence.
- About ShoutlyAI?
  - Yes, reference answers it → answer directly.
  - Yes, reference lacks it → name the missing topic, then tell them to email ${SUPPORT_EMAIL}.
  - No → say you don't have that info. No email.`

    const stream = await deepseek.chat.completions.create({
      model: CHAT_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 500,
      stream: true,
      stream_options: { include_usage: true },
    })

    let fullAnswer = ''
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content ?? ''
      if (text) {
        fullAnswer += text
        yield `data: ${JSON.stringify({ text })}\n\n`
      }
      if (chunk.usage) {
        this.aiUsageLogService.logText({
          userId: null,
          provider: 'DEEPSEEK',
          model: CHAT_MODEL,
          operation: 'CHAT',
          promptTokens: chunk.usage.prompt_tokens ?? 0,
          completionTokens: chunk.usage.completion_tokens ?? 0,
          metadata: { step: 'chat_stream' },
        })
      }
    }

    this.logger.log(`[streamChat] final answer: "${fullAnswer}"`)

    // Fire-and-forget — don't make the user wait on a Redis write that only benefits future turns.
    this.conversationMemory
      .addTurn(dto.sessionId, dto.query, fullAnswer)
      .catch((err) => this.logger.warn(`[streamChat] failed to save session history: ${err.message}`))

    yield `data: ${JSON.stringify({ meta: { cta: resolveCta(sources) } })}\n\n`
    yield `data: [DONE]\n\n`
  }

  async listDocuments(opts: { page: number; limit: number; search?: string }) {
    const { page, limit, search } = opts
    const offset = (page - 1) * limit

    const countRows = await this.prisma.$queryRawUnsafe<[{ count: string }]>(
      search
        ? `SELECT COUNT(*)::text AS count FROM rag_documents WHERE title ILIKE $1 OR content ILIKE $1`
        : `SELECT COUNT(*)::text AS count FROM rag_documents`,
      ...(search ? [`%${search}%`] : []),
    )
    const total = parseInt(countRows[0].count)

    const rows = await this.prisma.$queryRawUnsafe<Array<RagDocument & { metadata: string }>>(
      search
        ? `SELECT id::text, title, content, metadata::text, created_at::text, updated_at::text
           FROM rag_documents
           WHERE title ILIKE $1 OR content ILIKE $1
           ORDER BY created_at DESC
           LIMIT $2 OFFSET $3`
        : `SELECT id::text, title, content, metadata::text, created_at::text, updated_at::text
           FROM rag_documents
           ORDER BY created_at DESC
           LIMIT $1 OFFSET $2`,
      ...(search ? [`%${search}%`, limit, offset] : [limit, offset]),
    )

    const data = rows.map((r) => ({
      ...r,
      metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata,
    }))

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    }
  }

  async updateDocument(id: string, dto: { title?: string; content?: string; metadata?: Record<string, any> }, context?: AiUsageContext) {
    const existing = await this.prisma.$queryRawUnsafe<Array<{ id: string; title: string; content: string; metadata: string }>>(
      `SELECT id::text, title, content, metadata::text FROM rag_documents WHERE id = $1::uuid`,
      id,
    )
    if (!existing || existing.length === 0) throw new NotFoundException(`Document ${id} not found`)

    const current = existing[0]
    const newTitle = dto.title ?? current.title
    const newContent = dto.content ?? current.content
    const newMetadata = dto.metadata ?? (typeof current.metadata === 'string' ? JSON.parse(current.metadata) : current.metadata)

    const embedding = await this.embedText(`${newTitle}\n${newContent}`, context)
    const vectorStr = `[${embedding.join(',')}]`

    const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `UPDATE rag_documents
       SET title = $1, content = $2, metadata = $3::jsonb, embedding = $4::vector, updated_at = now()
       WHERE id = $5::uuid
       RETURNING id`,
      newTitle,
      newContent,
      JSON.stringify(newMetadata),
      vectorStr,
      id,
    )

    if (!rows || rows.length === 0) throw new NotFoundException(`Document ${id} not found`)

    return { success: true, id, title: newTitle, message: 'Document updated and embedding refreshed' }
  }

  async deleteDocument(id: string): Promise<{ message: string }> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `DELETE FROM rag_documents WHERE id = $1::uuid RETURNING id`,
      id,
    )
    if (rows.length === 0) throw new NotFoundException(`Document ${id} not found`)
    return { message: 'Document deleted successfully' }
  }
}
