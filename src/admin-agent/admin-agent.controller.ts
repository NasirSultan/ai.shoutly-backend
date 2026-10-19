import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common'
import type { Response } from 'express'
import { AuthGuard } from '../common/guards/auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import type { RequestWithUser } from '../common/types/request-with-user'
import { AdminAgentService } from './admin-agent.service'
import { AdminAgentChatDto } from './dto/admin-agent-chat.dto'
import { AgentAdmin } from './tools/define-tool'

const adminOf = (req: RequestWithUser): AgentAdmin => ({ id: req.user.id, email: req.user.email ?? '' })

@Controller('admin/agent')
@UseGuards(AuthGuard, new RolesGuard(['SUPERADMIN']))
export class AdminAgentController {
  constructor(private readonly adminAgent: AdminAgentService) {}

  @Post('chat')
  @HttpCode(HttpStatus.OK)
  chat(@Body(ValidationPipe) dto: AdminAgentChatDto, @Req() req: RequestWithUser) {
    return this.adminAgent.chat(adminOf(req), dto)
  }

  @Post('chat/stream')
  async streamChat(@Body(ValidationPipe) dto: AdminAgentChatDto, @Req() req: RequestWithUser, @Res() res: Response) {
    const turn = await this.adminAgent.prepareTurn(adminOf(req), dto)

    const abort = new AbortController()
    res.on('close', () => {
      if (!res.writableEnded) abort.abort()
    })

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    for await (const event of this.adminAgent.streamTurn(turn, abort.signal)) {
      if (abort.signal.aborted) break
      res.write(event)
    }
    res.end()
  }

  @Get('threads')
  listThreads(@Req() req: RequestWithUser) {
    return this.adminAgent.listThreads(adminOf(req))
  }

  @Get('threads/:id')
  getThread(@Param('id', ParseUUIDPipe) id: string, @Req() req: RequestWithUser) {
    return this.adminAgent.getThread(adminOf(req), id)
  }

  @Delete('threads/:id')
  deleteThread(@Param('id', ParseUUIDPipe) id: string, @Req() req: RequestWithUser) {
    return this.adminAgent.deleteThread(adminOf(req), id)
  }
}
