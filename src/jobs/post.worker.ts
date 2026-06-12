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
import { PrismaClient } from '@prisma/client'
import { RedisService } from '../common/redis/redis.service'
import { BrevoService } from '../brevo/brevo.service'
import { DateTime } from 'luxon'
import axios from 'axios'

const prisma = new PrismaClient()

interface PublishJobData {
  calendarPostId: string
}

@Injectable()
export class PostWorker implements OnModuleInit {
  private worker!: Worker<PublishJobData>

  // 🎯 Hardcoded here based on your controller configuration—ideally read from config/env variables
  private readonly outstandBaseUrl = 'https://api.outstand.so/v1'
  private readonly outstandApiKey = 'ost_DFRKRnqHLgDCZGDqYCXywbmkFQOnqNtBHhpyGpnkqFsIFkdCSycGcbkTOECKlnta'

  constructor(
    private readonly redisService: RedisService,
    private readonly brevoService: BrevoService,
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

      if (job && job.attemptsMade >= (job.opts.attempts || 3)) {
        await prisma.calendarPost.update({
          where: { id: job.data.calendarPostId },
          data: { status: 'FAILED' },
        })
      }
    })
    
    this.worker.on('error', (err) => {
      console.error('❌ Worker Error:', err)
    })
    } catch (err) {
      console.error('[PostWorker] FAILED TO START WORKER:', err) // ← ADD THIS
  }
  }

  private async process(job: Job<PublishJobData>) {
    const { calendarPostId } = job.data

    // 1. Resolve calendar structural items along with relational social accounts
    const post = await prisma.calendarPost.findUnique({
      where: { id: calendarPostId },
      include: {
        user: {
          include: { socialAccounts: { where: { status: 'active' } } }
        },
        content: true,
        image: true,
        reel: true,
      },
    })

    if (!post) throw new Error(`Post ${calendarPostId} not found`)
    if (post.status !== 'POSTING') throw new Error(`Post ${calendarPostId} already handled: ${post.status}`)

    const { user } = post
    if (!user.socialAccounts || user.socialAccounts.length === 0) {
      throw new Error(`User ${user.id} has no connected Outstand channels verified available`)
    }

    // 2. Map structural Outstand profile IDs array
    const outstandAccountIds = user.socialAccounts.map((acc) => acc.outstandAccountId)

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

    // 4. Dispatch transaction payload directly to Outstand engine endpoint
    try {
      const response = await axios.post(
        `${this.outstandBaseUrl}/posts/`,
        {
          accounts: outstandAccountIds, // Sends to all active accounts at once (Facebook & Instagram)
          containers: [container],
        },
        {
          headers: {
            'Authorization': `Bearer ${this.outstandApiKey}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
        }
      )

      // 5. Explicitly flip state tracking status flags to POSTED upon remote delivery completion
      await prisma.calendarPost.update({
        where: { id: calendarPostId },
        data: { status: 'POSTED' },
      })

      // 6. Push transactional status confirmation email to user via Brevo
      if (user.email) {
        const tz = user.timezone || 'Asia/Karachi'
        const postedAt = DateTime.now().setZone(tz).toFormat("MMM dd, yyyy 'at' hh:mm a")
        const dynamicPlatformsLabel = user.socialAccounts.map(a => a.platform).join(' & ')

        await this.brevoService.sendPostPublishedEmail(
          user.email,
          user.name || 'Creator',
          dynamicPlatformsLabel,
          postedAt,
        ).catch((err) => {
          console.error('[Brevo Alert Failed]:', err?.message || err?.response?.data || JSON.stringify(err))
        })
      }

      return response.data

    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        console.error('--- OUTSTAND CRITICAL REMOTE EXCEPTION ---')
        console.error(JSON.stringify(error.response.data, null, 2))
        throw new Error(`Outstand Rejected Data: ${error.response.data?.message || error.message}`)
      }
      throw error
    }
  }
}