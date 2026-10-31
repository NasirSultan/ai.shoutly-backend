import { Module } from '@nestjs/common'
import { BrevoService } from './brevo.service'
import { PostPublishedListener } from './post-published.listener'
import { NewUserAlertListener } from './new-user-alert.listener'

@Module({
  providers: [BrevoService, PostPublishedListener, NewUserAlertListener],
  exports: [BrevoService]
})
export class BrevoModule {}