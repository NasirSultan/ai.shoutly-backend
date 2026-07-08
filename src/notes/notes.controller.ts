import { Controller, Get, Patch, Body, Req, UseGuards } from '@nestjs/common'
import { NotesService } from './notes.service'
import { AuthGuard } from '../common/guards/auth.guard'

@Controller('notes')
export class NotesController {
  constructor(private readonly notesService: NotesService) {}

  @UseGuards(AuthGuard)
  @Get()
  async getNote(@Req() req) {
    return this.notesService.get(req.user.id)
  }

  @UseGuards(AuthGuard)
  @Patch()
  async updateNote(@Req() req, @Body('text') text: string) {
    return this.notesService.upsert(req.user.id, text ?? '')
  }
}
