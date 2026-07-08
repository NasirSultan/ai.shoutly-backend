import { Module } from '@nestjs/common'
import { NotesService } from './notes.service'
import { NotesController } from './notes.controller'
import { AuthModule } from '../auth/auth.module'

@Module({
  imports: [AuthModule],
  providers: [NotesService],
  controllers: [NotesController],
  exports: [NotesService]
})
export class NotesModule {}
