import { Module } from '@nestjs/common'
import { BrevoService } from './brevo.service'
import { PostPublishedListener } from './post-published.listener'

@Module({
  providers: [BrevoService, PostPublishedListener],
  exports: [BrevoService]
})
export class BrevoModule {}