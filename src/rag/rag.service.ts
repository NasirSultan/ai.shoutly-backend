import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common'
import { GoogleGenAI } from '@google/genai'
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
  contextUsed: boolean
  sources: Array<{
    id: string
    title: string
    content: string
    similarity: number
    metadata: Record<string, any>
  }>
  retrievedAt: string
}

@Injectable()
export class RagService {
  private readonly ai: GoogleGenAI
  private readonly EMBEDDING_MODEL = 'text-embedding-004'
  private readonly CHAT_MODEL = 'gemini-2.5-flash'

  constructor(private readonly prisma: PrismaService) {
    this.ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY })
  }

  async embedText(text: string): Promise<number[]> {
    try {
      const response = await this.ai.models.embedContent({
        model: this.EMBEDDING_MODEL,
        contents: [{ parts: [{ text }] }],
      })
      const values = response.embeddings?.[0]?.values
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
        `INSERT INTO rag_documents (title, content, metadata, embedding)
         VALUES ($1, $2, $3::jsonb, $4::vector)
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
      const result = await this.indexDocument(doc)
      results.push(result)
    }

    const indexed = results.filter((r) => r.success).length
    const failed = results.filter((r) => !r.success).length
    const allSuccess = failed === 0

    return {
      success: allSuccess,
      total: dto.documents.length,
      indexed,
      failed,
      results,
      message: allSuccess
        ? `All ${indexed} document(s) indexed successfully`
        : `${indexed} of ${dto.documents.length} indexed — ${failed} failed`,
    }
  }

  async searchSimilar(query: string, topK = 5): Promise<RagDocumentWithScore[]> {
    const embedding = await this.embedText(query)
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

    let geminiResult: { answer: string; confidence: 'high' | 'medium' | 'low'; contextUsed: boolean }

    try {
      const result = await this.ai.models.generateContent({
        model: this.CHAT_MODEL,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      })

      const raw = (result.text ?? '').trim()
      const jsonMatch = raw.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('No JSON in response')
      geminiResult = JSON.parse(jsonMatch[0])
    } catch (error: any) {
      throw new InternalServerErrorException(`Chat generation failed: ${error.message}`)
    }

    return {
      success: true,
      query: dto.query,
      answer: geminiResult.answer,
      confidence: geminiResult.confidence,
      contextUsed: geminiResult.contextUsed,
      sources: sources.map((s) => ({
        id: s.id,
        title: s.title,
        content: s.content,
        similarity: s.similarity,
        metadata: s.metadata,
      })),
      retrievedAt: new Date().toISOString(),
    }
  }

  async listDocuments(): Promise<RagDocument[]> {
    const rows = await this.prisma.$queryRawUnsafe<Array<RagDocument & { metadata: string }>>(
      `SELECT id::text, title, content, metadata::text, created_at::text, updated_at::text
       FROM rag_documents
       ORDER BY created_at DESC`,
    )
    return rows.map((r) => ({
      ...r,
      metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata,
    }))
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
