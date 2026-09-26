import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Req,
  Res,
  UseGuards,
  HttpException,
  InternalServerErrorException,
  Logger,
  ValidationPipe,
} from '@nestjs/common'
import type { Request, Response } from 'express'
import { ContactService, ContactRateLimitedException } from './contact.service'
import { UpdateContactStatusDto } from './dto/update-contact-status.dto'
import { MESSAGES } from './contact.config'
import { AuthGuard } from '../common/guards/auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'

// First hop in X-Forwarded-For is the client when running behind a proxy.
function getClientIp(req: Request) {
  const forwarded = req.headers['x-forwarded-for']
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim()
  return first || req.ip || req.socket.remoteAddress || 'unknown'
}

@Controller('contact')
export class ContactController {
  private readonly logger = new Logger(ContactController.name)

  constructor(private readonly contactService: ContactService) {}

  // Public "Send us a message" form. The body is validated by the service so
  // every field error comes back together in `fieldErrors`.
  @Post()
  async create(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      return await this.contactService.submit(body, getClientIp(req))
    } catch (err) {
      if (err instanceof ContactRateLimitedException) {
        res.setHeader('Retry-After', String(err.retryAfterSeconds))
      }
      if (err instanceof HttpException) throw err
      // Never leak internals: the frontend shows `error` to the user as is.
      this.logger.error(`Contact submit failed: ${(err as Error).message}`)
      throw new InternalServerErrorException({ success: false, error: MESSAGES.serverError })
    }
  }

  @Get()
  @UseGuards(AuthGuard, new RolesGuard(['SUPERADMIN']))
  findAll() {
    return this.contactService.findAll()
  }

  @Get(':id')
  @UseGuards(AuthGuard, new RolesGuard(['SUPERADMIN']))
  findOne(@Param('id') id: string) {
    return this.contactService.findOne(id)
  }

  @Patch(':id/status')
  @UseGuards(AuthGuard, new RolesGuard(['SUPERADMIN']))
  updateStatus(@Param('id') id: string, @Body(ValidationPipe) dto: UpdateContactStatusDto) {
    return this.contactService.updateStatus(id, dto.status)
  }

  @Patch(':id/toggle-status')
  @UseGuards(AuthGuard, new RolesGuard(['SUPERADMIN']))
  toggleStatus(@Param('id') id: string) {
    return this.contactService.toggleStatus(id)
  }

  @Delete(':id')
  @UseGuards(AuthGuard, new RolesGuard(['SUPERADMIN']))
  remove(@Param('id') id: string) {
    return this.contactService.remove(id)
  }
}
