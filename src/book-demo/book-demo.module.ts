import { Module } from '@nestjs/common'
import { BookDemoController } from './book-demo.controller'
import { BookDemoService } from './book-demo.service'
import { AuthModule } from '../auth/auth.module'

@Module({
  imports: [AuthModule],
  controllers: [BookDemoController],
  providers: [BookDemoService],
})
export class BookDemoModule {}
