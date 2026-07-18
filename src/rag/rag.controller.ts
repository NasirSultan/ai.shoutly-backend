import {
  Controller,
  Post,
  Get,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  ValidationPipe,
  UseGuards,
} from '@nestjs/common'
import { Response } from 'express'
import { RagService } from './rag.service'
import { UploadDocumentDto } from './dto/upload-document.dto'
import { BulkUploadDto } from './dto/bulk-upload.dto'
import { ChatQueryDto } from './dto/chat-query.dto'
import { UpdateDocumentDto } from './dto/update-document.dto'
import { AuthGuard } from '../common/guards/auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'

@Controller('rag')
export class RagController {
  constructor(private readonly ragService: RagService) {}

  /**
   * POST /rag/documents
   * Index a document — embeds it and stores in Supabase pgvector.
   */
  @Post('documents')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(AuthGuard, new RolesGuard(['SUPERADMIN']))
  indexDocument(@Body(ValidationPipe) dto: UploadDocumentDto, @Req() req) {
    return this.ragService.indexDocument(dto, { userId: req.user.id })
  }

  /**
   * POST /rag/documents/bulk
   * Index multiple documents at once — returns success/failed breakdown.
   * success:true only when ALL documents are indexed without error.
   */
  @Post('documents/bulk')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, new RolesGuard(['SUPERADMIN']))
  bulkIndex(@Body(new ValidationPipe({ transform: true })) dto: BulkUploadDto, @Req() req) {
    return this.ragService.bulkIndexDocuments(dto, { userId: req.user.id })
  }

  /**
   * GET /rag/documents
   * List all indexed documents with pagination and optional search.
   * Query params: page (default 1), limit (default 10), search (optional keyword)
   */
  @Get('documents')
  listDocuments(
    @Query('page') page = '1',
    @Query('limit') limit = '10',
    @Query('search') search?: string,
  ) {
    return this.ragService.listDocuments({
      page: Math.max(1, parseInt(page) || 1),
      limit: Math.min(100, Math.max(1, parseInt(limit) || 10)),
      search: search?.trim() || undefined,
    })
  }

  /**
   * PATCH /rag/documents/:id
   * Update title, content, and/or metadata — re-generates embedding automatically.
   */
  @Patch('documents/:id')
  @UseGuards(AuthGuard, new RolesGuard(['SUPERADMIN']))
  updateDocument(@Param('id') id: string, @Body(ValidationPipe) dto: UpdateDocumentDto, @Req() req) {
    return this.ragService.updateDocument(id, dto, { userId: req.user.id })
  }

  /**
   * DELETE /rag/documents/:id
   * Remove a document from the vector store.
   */
  @Delete('documents/:id')
  @UseGuards(AuthGuard, new RolesGuard(['SUPERADMIN']))
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
