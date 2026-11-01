import { Injectable, Logger } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import { BrevoService } from './brevo.service'
import { UserSignedUpEvent } from '../events/user-signed-up.event'

const DEFAULT_RECIPIENTS = 'leads@shoutlyai.com,rainasirsultan123@gmail.com'

@Injectable()
export class NewUserAlertListener {
  private readonly logger = new Logger(NewUserAlertListener.name)

  constructor(private readonly brevoService: BrevoService) {}

  @OnEvent('user.signed-up', { async: true })
  async handleUserSignedUp(event: UserSignedUpEvent): Promise<void> {
    try {
      const recipients = (process.env.NEW_USER_ALERT_EMAILS || DEFAULT_RECIPIENTS)
        .split(',')
        .map((e) => e.trim())
        .filter(Boolean)

      await this.brevoService.sendNewUserAlert(recipients, {
        name: event.name,
        email: event.email,
        method: event.method,
        signedUpAt: event.signedUpAt.toISOString().replace('T', ' ').slice(0, 16) + ' UTC',
      })
    } catch (error: any) {
      const detail = error?.response?.body?.message ?? error?.message ?? 'unknown error'
      this.logger.error(`failed to send new user alert: ${detail}`)
    }
  }
}
