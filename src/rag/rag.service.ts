import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common'
import OpenAI from 'openai'
import { PrismaService } from '../lib/prisma.service'
import { UploadDocumentDto } from './dto/upload-document.dto'
import { BulkUploadDto } from './dto/bulk-upload.dto'
import { ChatQueryDto } from './dto/chat-query.dto'

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
}

// OpenAI — embeddings only (text-embedding-3-small, 768-dim matches DB schema)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// DeepSeek — chat and stream via OpenAI-compatible SDK
const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com',
})
const CHAT_MODEL = 'deepseek-chat'

@Injectable()
export class RagService {
  constructor(private readonly prisma: PrismaService) {}

  async embedText(text: string): Promise<number[]> {
    try {
      const response = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
        dimensions: 768,
      })
      const values = response.data[0]?.embedding
      if (!values || values.length === 0) throw new Error('Empty embedding returned')
      return values
    } catch (error: any) {
      throw new InternalServerErrorException(`Embedding failed: ${error.message}`)
    }
  }

  async indexDocument(dto: UploadDocumentDto): Promise<IndexResult> {
    try {
      const embedding = await this.embedText(dto.content)
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

  async bulkIndexDocuments(dto: BulkUploadDto): Promise<BulkIndexResult> {
    const results: IndexResult[] = []
    for (const doc of dto.documents) {
      results.push(await this.indexDocument(doc))
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

  async searchSimilar(query: string, topK = 5): Promise<RagDocumentWithScore[]> {
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
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      vectorStr,
      limit,
    )

    return rows.map((r) => ({
      ...r,
      metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata,
      similarity: Number(r.similarity),
    }))
  }

  async chat(dto: ChatQueryDto): Promise<ChatResponse> {
    const topK = dto.topK ?? 5
    const sources = await this.searchSimilar(dto.query, topK)

    const contextUsed = sources.length > 0
    const contextBlock = sources
      .map((s, i) => `[${i + 1}] "${s.title}" (similarity: ${s.similarity.toFixed(3)})\n${s.content}`)
      .join('\n\n---\n\n')

    const prompt = `You are a helpful assistant that answers questions based ONLY on provided context documents.

${contextUsed ? `Context documents:\n---\n${contextBlock}\n---` : 'No context documents were found.'}

User question: ${dto.query}

Rules:
- Answer ONLY from the context above
- If context is insufficient, clearly say so
- Be concise and factual
- Do NOT invent or assume information

Respond with valid JSON only, exactly in this format:
{
  "answer": "<your answer>",
  "confidence": "<high|medium|low>",
  "contextUsed": <true|false>
}`

    try {
      const completion = await deepseek.chat.completions.create({
        model: CHAT_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
      })

      const raw = (completion.choices[0]?.message?.content ?? '').trim()
      const jsonMatch = raw.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('No JSON in DeepSeek response')

      const parsed: { answer: string; confidence: 'high' | 'medium' | 'low'; contextUsed: boolean } =
        JSON.parse(jsonMatch[0])

      return {
        success: true,
        query: dto.query,
        answer: parsed.answer,
        confidence: parsed.confidence,
        retrievedAt: new Date().toISOString(),
      }
    } catch (error: any) {
      throw new InternalServerErrorException(`Chat generation failed: ${error.message}`)
    }
  }

  async *streamChat(dto: ChatQueryDto): AsyncGenerator<string> {
    const sources = await this.searchSimilar(dto.query, dto.topK ?? 5)
    const top2 = sources.slice(0, 2)

    const contextBlock = top2
      .map((s, i) => `[${i + 1}] "${s.title}"\n${s.content}`)
      .join('\n\n---\n\n')

    const prompt = `You are a helpful assistant. Answer ONLY from the context below.

Context:
---
${contextBlock}
---

Question: ${dto.query}

Rules: Answer from context only. If insufficient, say so. Be concise.`

    const stream = await deepseek.chat.completions.create({
      model: CHAT_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      stream: true,
    })

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content ?? ''
      if (text) yield `data: ${JSON.stringify({ text })}\n\n`
    }

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

  async updateDocument(id: string, dto: { title?: string; content?: string; metadata?: Record<string, any> }) {
    const existing = await this.prisma.$queryRawUnsafe<Array<{ id: string; title: string; content: string; metadata: string }>>(
      `SELECT id::text, title, content, metadata::text FROM rag_documents WHERE id = $1::uuid`,
      id,
    )
    if (!existing || existing.length === 0) throw new NotFoundException(`Document ${id} not found`)

    const current = existing[0]
    const newTitle = dto.title ?? current.title
    const newContent = dto.content ?? current.content
    const newMetadata = dto.metadata ?? (typeof current.metadata === 'string' ? JSON.parse(current.metadata) : current.metadata)

    const embedding = await this.embedText(newContent)
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
