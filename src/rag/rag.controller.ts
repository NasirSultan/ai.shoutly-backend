import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Res,
  HttpCode,
  HttpStatus,
  ValidationPipe,
} from '@nestjs/common'
import { Response } from 'express'
import { RagService } from './rag.service'
import { UploadDocumentDto } from './dto/upload-document.dto'
import { BulkUploadDto } from './dto/bulk-upload.dto'
import { ChatQueryDto } from './dto/chat-query.dto'

@Controller('rag')
export class RagController {
  constructor(private readonly ragService: RagService) {}

  /**
   * POST /rag/documents
   * Index a document — embeds it with Gemini and stores in Supabase pgvector.
   */
  @Post('documents')
  @HttpCode(HttpStatus.CREATED)
  indexDocument(@Body(ValidationPipe) dto: UploadDocumentDto) {
    return this.ragService.indexDocument(dto)
  }

  /**
   * POST /rag/documents/bulk
   * Index multiple documents at once — returns success/failed breakdown.
   * success:true only when ALL documents are indexed without error.
   */
  @Post('documents/bulk')
  @HttpCode(HttpStatus.OK)
  bulkIndex(@Body(new ValidationPipe({ transform: true })) dto: BulkUploadDto) {
    return this.ragService.bulkIndexDocuments(dto)
  }

  /**
   * GET /rag/documents
   * List all indexed documents (without embeddings).
   */
  @Get('documents')
  listDocuments() {
    return this.ragService.listDocuments()
  }

  /**
   * DELETE /rag/documents/:id
   * Remove a document from the vector store.
   */
  @Delete('documents/:id')
  deleteDocument(@Param('id') id: string) {
    return this.ragService.deleteDocument(id)
  }

  /**
   * POST /rag/chat
   * Ask a question — retrieves top-K similar documents and answers via Gemini.
   * Returns JSON: { success, query, answer, confidence, contextUsed, sources, retrievedAt }
   */
  @Post('chat')
  @HttpCode(HttpStatus.OK)
  chat(@Body(ValidationPipe) dto: ChatQueryDto) {
    return this.ragService.chat(dto)
  }

  /**
   * POST /rag/search
   * Pure vector similarity search — returns matching documents with scores.
   */
  @Post('search')
  @HttpCode(HttpStatus.OK)
  search(@Body(ValidationPipe) dto: ChatQueryDto) {
    return this.ragService.searchSimilar(dto.query, dto.topK)
  }

  /**
   * POST /rag/chat/stream
   * Streaming chat with typing effect via Server-Sent Events.
   * Returns: sources first, then answer chunks, then done signal.
   */
  @Post('chat/stream')
  async streamChat(
    @Body(ValidationPipe) dto: ChatQueryDto,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    for await (const chunk of this.ragService.streamChat(dto)) {
      res.write(chunk)
    }

    res.end()
  }
}
