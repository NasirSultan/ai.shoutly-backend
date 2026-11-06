// import { Injectable, OnModuleInit } from '@nestjs/common'
// import { Worker, Job } from 'bullmq'
// import { PrismaClient } from '@prisma/client'
// import { RedisService } from '../common/redis/redis.service'
// import { FacebookService } from '../social-media/facebook/facebook.service'
// import { BrevoService } from 'src/brevo/brevo.service'
// import { DateTime } from 'luxon'

// const prisma = new PrismaClient()

// interface PublishJobData {
//   calendarPostId: string
// }

// @Injectable()
// export class PostWorker implements OnModuleInit {
//   private worker!: Worker<PublishJobData>

//   constructor(
//     private readonly redisService: RedisService,
//     private readonly facebookService: FacebookService,
//     private readonly brevoService: BrevoService,
//   ) {}

//   onModuleInit() {
//     this.worker = new Worker<PublishJobData>(
//       'facebook-post',
//       async (job: Job<PublishJobData>) => this.process(job),
//       {
//         connection: this.redisService.createIORedisClient(),
//         concurrency: 5,
//       },
//     )

//     this.worker.on('completed', (job) => {
//       console.log(`[Worker] Job ${job.id} completed`)
//     })

//     this.worker.on('failed', async (job, err) => {
//       console.error(`[Worker] Job ${job?.id} failed:`, err.message)

//       if (job && job.attemptsMade >= (job.opts.attempts || 3)) {
//         await prisma.calendarPost.update({
//           where: { id: job.data.calendarPostId },
//           data: { status: 'FAILED' },
//         })
//       }
//     })
//   }

//   private async process(job: Job<PublishJobData>) {
//     const { calendarPostId } = job.data

//     const post = await prisma.calendarPost.findUnique({
//       where: { id: calendarPostId },
//       include: {
//         user: {
//           include: {
//             facebookAccount: {
//               include: { pages: true },
//             },
//           },
//         },
//         content: {
//           include: {
//             hashtags: { include: { hashtag: true } },
//           },
//         },
//         image: true,
//         reel: true,
//       },
//     })

//     if (!post) throw new Error(`Post ${calendarPostId} not found`)
//     if (post.status !== 'POSTING') throw new Error(`Post ${calendarPostId} already ${post.status}`)

//     const { user } = post
//     const fbAccount = user.facebookAccount
//     if (!fbAccount) throw new Error(`User ${user.id} has no Facebook account`)

//     const defaultPage = fbAccount.pages.find((p) => p.isDefault) || fbAccount.pages[0]
//     if (!defaultPage) throw new Error(`User ${user.id} has no Facebook page`)

//     const hashtags = post.content?.hashtags?.map((ch) => ch.hashtag.tag) || []
//     const imageUrl = post.image?.file || post.imageUrl || undefined

//     const result = await this.facebookService.postToPage({
//       pageId: defaultPage.pageId,
//       title: user.brandName || '',
//       message: post.content?.text || '',
//       imageUrl,
//       hashtags,
//     })

//     await prisma.calendarPost.update({
//       where: { id: calendarPostId },
//       data: { status: 'POSTED' },
//     })

//     const userData = await prisma.user.findUnique({
//       where: { id: user.id },
//       select: { email: true, name: true, timezone: true },
//     })

//     if (userData?.email) {
//       const tz = userData.timezone || 'Asia/Karachi'
//       const postedAt = DateTime.now().setZone(tz).toFormat("MMM dd, yyyy 'at' hh:mm a")

//       await this.brevoService.sendPostPublishedEmail(
//         userData.email,
//         userData.name,
//         defaultPage.pageName || defaultPage.pageId,
//         postedAt,
//       ).catch((err) => console.error('[Brevo] Email failed:', err.message))
//     }

//     return result
//   }
// }


import { Injectable, OnModuleInit } from '@nestjs/common'
import { Worker, Job } from 'bullmq'
import { RedisService } from '../common/redis/redis.service'
import axios from 'axios'
import { prisma } from '../lib/prisma'
import { PUBLISH_RESULTS_TTL_SECONDS, SavedPlatformResult, publishResultsKey } from './publish-results'
import { LinkedInService } from '../social-media/linkedin/linkedin.service'
import { YoutubeService } from '../social-media/youtube/youtube.service'
import { GoogleBusinessService } from '../social-media/google-business/google-business.service'
import { XService } from '../social-media/x/x.service'
import { FacebookService } from '../social-media/facebook/facebook.service'
import { MonitoringService } from '../monitoring/monitoring.service'
import { captureError } from '../monitoring/sentry'

interface PublishJobData {
  calendarPostId: string
}

interface PlatformResult {
  platform: string
  accountName: string
  ok: boolean
  reason?: string
}

@Injectable()
export class PostWorker implements OnModuleInit {
  private worker!: Worker<PublishJobData>

  // 🎯 Hardcoded here based on your controller configuration—ideally read from config/env variables
  private readonly outstandBaseUrl = process.env.OUTSTAND_BASE_URL ?? 'https://api.outstand.so/v1'
  private readonly outstandApiKey = process.env.OUTSTAND_API_KEY ?? ''

  constructor(
    private readonly redisService: RedisService,
    private readonly linkedInService: LinkedInService,
    private readonly youtubeService: YoutubeService,
    private readonly googleBusinessService: GoogleBusinessService,
    private readonly xService: XService,
    private readonly facebookService: FacebookService,
    private readonly monitoring: MonitoringService,
  ) {
    console.log('[Worker Lifecycle] PostWorker Instantiated by NestJS Runtime! 🚀');
  }

  onModuleInit() {
    try {
    this.worker = new Worker<PublishJobData>(
      'facebook-post', // Maintained for queue registration backward compatibility
      async (job: Job<PublishJobData>) => this.process(job),
      {
        connection: this.redisService.createIORedisClient(),
        concurrency: 5, // Allows 5 asynchronous outbound requests out to Outstand simultaneously
      },
    )

    this.worker.on('completed', (job) => {
      console.log(`[Outstand Worker] Job ${job.id} dispatched successfully to Outstand Engine`)
    })

    this.worker.on('failed', async (job, err) => {
      console.error(`[Outstand Worker] Job ${job?.id} structural processing failed:`, err.message)

      if (job && job.attemptsMade >= (job.opts.attempts || 1)) {
        // Only a post still in flight can fail. Matching on POSTING means a
        // stray duplicate job can never overwrite a post that another job
        // already published (POSTED) or that was skipped (SKIP).
        await prisma.calendarPost.updateMany({
          where: { id: job.data.calendarPostId, status: 'POSTING' },
          data: { status: 'FAILED' },
        })
        // Final failure only (not each retry). The watchdog also emails an
        // alert for posts that became FAILED.
        captureError(err, 'publish-worker', { postId: job.data.calendarPostId, jobId: job.id, attempts: job.attemptsMade })
      }
    })

    this.worker.on('error', (err) => {
      console.error('❌ Worker Error:', err)
      captureError(err, 'publish-worker')
    })
    } catch (err) {
      console.error('[PostWorker] FAILED TO START WORKER:', err) // ← ADD THIS
  }
  }

  private async process(job: Job<PublishJobData>) {
    const { calendarPostId } = job.data

    // Guards against this post being published twice — e.g. BullMQ's
    // stalled-job detection re-dispatching this same job to another worker
    // while a slow, media-heavy first attempt is still in flight with
    // Outstand (media posts take noticeably longer than text-only ones,
    // which is exactly when this showed up). Only one concurrent run can
    // acquire the lock; any other run for the same post bails out
    // immediately instead of calling Outstand a second time. Released in
    // the finally block below regardless of success/failure, so BullMQ's
    // own legitimate attempt-retry (on real failures) still works normally.
    const lockKey = `publish-lock:${calendarPostId}`
    const acquired = await this.redisService.getClient().set(lockKey, String(job.id ?? '1'), {
      NX: true,
      EX: 300,
    })
    if (!acquired) {
      console.warn(`[Outstand Worker] Post ${calendarPostId} is already being published — skipping duplicate run.`)
      return { skipped: true, reason: 'duplicate-run' }
    }

    try {
      return await this.publishPost(calendarPostId)
    } finally {
      await this.redisService.getClient().del(lockKey)
    }
  }

  private async publishPost(calendarPostId: string) {
    // 1. Resolve calendar structural items along with relational social accounts
    const post = await prisma.calendarPost.findUnique({
      where: { id: calendarPostId },
      include: {
        user: {
          include: {
            socialAccounts: { where: { status: 'active' } },
            linkedAccounts: { where: { platform: 'LINKEDIN' } },
            youtubeAccount: true,
            xAccount: true,
            facebookAccount: { include: { pages: { orderBy: { createdAt: 'asc' } } } },
            googleBusinessAccount: { include: { locations: { where: { selected: true, canPost: true } } } },
          },
        },
        content: true,
        image: true,
        reel: true,
      },
    })

    // A post that's gone or no longer POSTING was already handled (e.g. a
    // duplicate job for a post another job just published). That's not a
    // failure: finish quietly instead of throwing, so BullMQ doesn't retry it
    // and the failed handler never touches the post's status.
    if (!post) {
      console.warn(`[Outstand Worker] Post ${calendarPostId} no longer exists — skipping.`)
      return { skipped: true, reason: 'not-found' }
    }
    if (post.status !== 'POSTING') {
      console.warn(`[Outstand Worker] Post ${calendarPostId} already handled (${post.status}) — skipping duplicate job.`)
      return { skipped: true, reason: `already-${post.status.toLowerCase()}` }
    }

    const { user } = post
    const targetPlatforms = post.targetPlatforms ?? []
    const activeAccounts = user.socialAccounts.filter((acc) => {
      // These platforms are published directly below, not through Outstand.
      if (acc.platform === 'YOUTUBE' || acc.platform === 'GOOGLE_BUSINESS' || acc.platform === 'X' || acc.platform === 'FACEBOOK') return false
      if (!targetPlatforms.length) return true
      return !!acc.platform && targetPlatforms.includes(acc.platform)
    })
    const wantsLinkedIn = !targetPlatforms.length || targetPlatforms.includes('LINKEDIN')
    const wantsYoutube = targetPlatforms.includes('YOUTUBE') || (
      !targetPlatforms.length && !!user.youtubeAccount && !!(post.youtubeVideoUrl || post.reel?.file)
    )
    const wantsGoogle = !targetPlatforms.length || targetPlatforms.includes('GOOGLE_BUSINESS')
    const wantsX = !targetPlatforms.length || targetPlatforms.includes('X')
    const wantsFacebook = !targetPlatforms.length || targetPlatforms.includes('FACEBOOK')
    const linkedInAccount = wantsLinkedIn ? user.linkedAccounts[0] : undefined
    const youtubeAccount = wantsYoutube ? user.youtubeAccount : undefined
    const googleLocations = wantsGoogle ? user.googleBusinessAccount?.locations ?? [] : []
    const xAccount = wantsX ? user.xAccount : undefined
    const facebookPages = wantsFacebook ? user.facebookAccount?.pages ?? [] : []
    const facebookPage = facebookPages.find((p) => p.isDefault) || facebookPages[0]

    if (!activeAccounts.length && !linkedInAccount && !youtubeAccount && !googleLocations.length && !xAccount && !facebookPage) {
      throw new Error(`User ${user.id} has no connected channels for the selected platforms`)
    }

    const outstandAccountIds = activeAccounts.map((acc) => acc.outstandAccountId)

    // 3. Construct unified container asset payload
    const container: any = {
      content: post.content?.text || '',
    }

    // Adapt to whichever media layout field populates within your schema
    const mediaUrl = post.image?.file || post.imageUrl || post.reel?.file || undefined

    if (mediaUrl) {
      container.media = [{
        url: mediaUrl,
        type: mediaUrl.endsWith('.mp4') || post.reel ? 'video' : 'image',
        filename: mediaUrl.substring(mediaUrl.lastIndexOf('/') + 1) || 'default_media',
      }]
    }

    // Each platform is published on its own: one failing must not stop the
    // others, and must not mark a post FAILED when it is already live
    // somewhere (a retry would then post it there a second time).
    const results: PlatformResult[] = []
    const attempt = async (targets: { platform: string; accountName: string }[], run: () => Promise<unknown>) => {
      try {
        await run()
        results.push(...targets.map((t) => ({ ...t, ok: true })))
      } catch (error) {
        const reason = this.errorReason(error)
        console.error(`[Outstand Worker] Post ${calendarPostId} failed on ${targets.map((t) => t.platform).join(', ')}: ${reason}`)
        results.push(...targets.map((t) => ({ ...t, ok: false, reason })))
      }
    }

    if (linkedInAccount) {
      await attempt([{ platform: 'LINKEDIN', accountName: 'LinkedIn' }], () =>
        this.linkedInService.publish({
          accessToken: linkedInAccount.accessToken,
          personId: linkedInAccount.platformUserId,
          commentary: container.content,
          mediaUrl,
          video: !!mediaUrl && (mediaUrl.split('?')[0].toLowerCase().endsWith('.mp4') || !!post.reel),
        }),
      )
    }

    if (youtubeAccount) {
      const videoUrl = post.youtubeVideoUrl || (post.reel?.file ? mediaUrl : undefined)
      await attempt([{ platform: 'YOUTUBE', accountName: youtubeAccount.channelTitle || 'YouTube' }], () =>
        this.youtubeService.publishForUser(user.id, container.content, videoUrl, {
          title: post.youtubeTitle || undefined,
          privacyStatus: (post.youtubePrivacy as 'public' | 'private' | 'unlisted' | null) || undefined,
          tags: post.youtubeTags ? post.youtubeTags.split(',').map((tag) => tag.trim()).filter(Boolean) : undefined,
          madeForKids: post.youtubeMadeForKids,
          isShort: post.youtubeIsShort,
        }),
      )
    }

    if (googleLocations.length) {
      await attempt(
        [{ platform: 'GOOGLE_BUSINESS', accountName: googleLocations.map((location) => location.title).join(', ') }],
        () => this.googleBusinessService.publishForUser(user.id, container.content, post.reel ? undefined : mediaUrl),
      )
    }

    if (xAccount) {
      await attempt([{ platform: 'X', accountName: xAccount.username ? `@${xAccount.username}` : 'X' }], () =>
        this.xService.publishForUser(user.id, container.content, mediaUrl ? [mediaUrl] : undefined),
      )
    }

    if (facebookPage) {
      await attempt([{ platform: 'FACEBOOK', accountName: facebookPage.pageName || 'Facebook Page' }], () =>
        this.facebookService.publishForUser(user.id, container.content, mediaUrl ? [mediaUrl] : undefined, {
          isVideo: !!post.reel,
        }),
      )
    }

    // One Outstand request covers all its accounts, so they succeed or fail together.
    let responseData: unknown = null
    if (outstandAccountIds.length) {
      const targets = activeAccounts.map((acc) => ({
        platform: acc.platform || 'Unknown',
        accountName: acc.username || acc.platform || 'Connected account',
      }))
      await attempt(targets, async () => {
        try {
          const response = await axios.post(
            `${this.outstandBaseUrl}/posts/`,
            { accounts: outstandAccountIds, containers: [container] },
            {
              headers: {
                'Authorization': `Bearer ${this.outstandApiKey}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
              },
            },
          )
          responseData = response.data
        } catch (error) {
          // Counts toward the "outstand errors" alert.
          if (axios.isAxiosError(error)) void this.monitoring.recordServiceError('outstand')
          throw error
        }
      })
    }

    const published = results.filter((r) => r.ok)
    const failed = results.filter((r) => !r.ok)

    // Live on at least one platform → POSTED. Only POSTING is updated so a
    // post reset or changed meanwhile is left alone.
    if (published.length) {
      await prisma.calendarPost.updateMany({
        where: { id: calendarPostId, status: 'POSTING' },
        data: { status: 'POSTED' },
      })
    }

    // No email here: the user gets one email per day (DailyPostSummaryService)
    // listing every platform as posted or failed. Save this post's results
    // for it, without reasons (those stay in logs, Sentry and the failed job).
    // A save error must not change the post's status.
    const saved: SavedPlatformResult[] = results.map(({ platform, accountName, ok }) => ({ platform, accountName, ok }))
    await this.redisService
      .getClient()
      .set(publishResultsKey(calendarPostId), JSON.stringify(saved), { EX: PUBLISH_RESULTS_TTL_SECONDS })
      .catch((err) => console.error(`[Outstand Worker] Could not save results for post ${calendarPostId}:`, err?.message || err))

    const failureSummary = failed.map((r) => `${r.platform}: ${r.reason}`).join(' | ')

    // Nothing went live: throw so the job fails, the post becomes FAILED and
    // the watchdog alerts. The message (shown on the admin monitoring page)
    // names each platform and why it failed.
    if (!published.length) {
      throw new Error(`Failed on every platform — ${failureSummary}`)
    }

    // Live somewhere but not everywhere: the post stays POSTED, so report the
    // failed platforms to Sentry for the admin.
    if (failed.length) {
      captureError(new Error(`Post partly published — ${failureSummary}`), 'publish-worker', {
        postId: calendarPostId,
        published: published.map((r) => r.platform),
        failed: failed.map((r) => ({ platform: r.platform, reason: r.reason })),
      })
    }

    return { results: results.map(({ platform, ok, reason }) => ({ platform, ok, reason })), outstand: responseData }
  }

  // A short, readable reason for logs and admin views (never sent to the user).
  private errorReason(error: unknown): string {
    if (axios.isAxiosError(error)) {
      const data = error.response?.data as { message?: string; error?: { message?: string } } | undefined
      return data?.message || data?.error?.message || error.message
    }
    if (error instanceof Error) return error.message
    return String(error)
  }
}