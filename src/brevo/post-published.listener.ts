import { Injectable, Logger } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import { DateTime } from 'luxon'
import { BrevoService } from './brevo.service'
import { PostPublishedEvent } from '../events/post-published.event'
import { normalizeTimezone } from '../common/utils/timezone.util'
import { buildPlatformRowsHtml } from '../common/utils/email-template.util'

@Injectable()
export class PostPublishedListener {
  private readonly logger = new Logger(PostPublishedListener.name)

  constructor(private readonly brevoService: BrevoService) {}

  // emit() is fire-and-forget from the producer's side — nothing awaits
  // this listener, so an unhandled rejection here would otherwise crash the
  // process instead of just failing the request/job. The try/catch is what
  // makes that isolation real, not just implied by the event pattern.
  @OnEvent('post.published')
  async handlePostPublished(event: PostPublishedEvent): Promise<void> {
    if (!event.userEmail) return

    try {
      const tz = normalizeTimezone(event.userTimezone, 'Asia/Karachi')
      const postedAt = DateTime.fromJSDate(event.publishedAt)
        .setZone(tz)
        .toFormat("MMM dd, yyyy 'at' hh:mm a")

      const platformRows = buildPlatformRowsHtml(
        event.platforms.map(({ platform, accountName }) => ({
          platform,
          accountName,
          postedAt,
        })),
      )

      await this.brevoService.sendPostPublishedEmail(
        event.userEmail,
        event.userName,
        platformRows,
      )
    } catch (error: any) {
      // Only ever log specific, known-safe fields here — never the whole
      // error object. Brevo's SDK nests the original outbound request
      // (including the Authorization/api-key header) inside its error
      // response; a blanket JSON.stringify(error) fallback would print
      // that secret straight into the logs.
      const detail =
        error?.response?.body?.message ??
        error?.response?.data?.message ??
        error?.message ??
        'unknown error'

      this.logger.error(`failed to send post-published email: ${detail}`)
    }
  }
}
