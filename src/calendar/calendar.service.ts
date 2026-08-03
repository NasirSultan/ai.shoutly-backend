import { Injectable,InternalServerErrorException ,NotFoundException} from '@nestjs/common'
import { generatePostsForMonth } from './generators/calendar.generator'
import { DateTime } from 'luxon'
import { randomUUID } from 'crypto'
import { prisma } from '../lib/prisma'
import { PostQueue } from '../jobs/post.queue'

@Injectable()
export class CalendarService {

  constructor(private readonly postQueue: PostQueue) {}


  private toUTC(timeStr: string, timezone: string, baseDate?: Date): Date {
    const [hours, minutes] = timeStr.split(':').map(Number)
    const base = baseDate ? DateTime.fromJSDate(baseDate) : DateTime.now()

    return base
      .setZone(timezone)
      .set({ hour: hours, minute: minutes, second: 0, millisecond: 0 })
      .toUTC()
      .toJSDate()
  }

  // Shared shape used by GET /calendar/plan, GET /calendar/post/:id, and now
  // POST /calendar/plan too, so all three return posts in the same clear format.
  private formatPost(post: any) {
    return {
      postId: post.id,
      postTime: post.postTime,
      status: post.status,
      content: post.content
        ? {
            contentId: post.content.id,
            text: post.content.text,
            hashtags: post.content.hashtags.map((ch: any) => `#${ch.hashtag.tag}`)
          }
        : null,
      media: post.imageUrl
        ? { type: post.type === 'FESTIVAL' ? 'FESTIVAL' : 'IMAGE', id: post.imageId, file: post.imageUrl }
        : post.image
        ? { type: 'IMAGE', id: post.image.id, file: post.image.file }
        : post.reel
        ? { type: 'REEL', id: post.reel.id, file: post.reel.file }
        : null
    }
  }

  private async getUserTimezone(userId: string): Promise<string> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    })
    return user?.timezone || 'UTC'
  }

  // Cached in-memory after first lookup per running instance. Not a schema
  // change — this is a single ordinary row, created once and reused.
  private reservedSubIndustryId: string | null = null

  // The Content/Image tables are the shared admin content bank that
  // generatePlan draws from for every user in a given sub-industry (see
  // generatePostsForMonth's `where: { subIndustryId: { in: subIndustryIds } }`
  // query). Manual, user-authored posts (createManualPost/updateManualPost)
  // still need to create Content/Image rows the same way createPost/updatePost
  // do, but must NOT be tagged with any real sub-industry — otherwise they'd
  // be eligible to get randomly pulled onto some other user's auto-generated
  // calendar. This reserved SubIndustry exists purely as a tag no real user's
  // subIndustryId will ever equal, so posts tagged with it can never match a
  // real generatePlan query.
  private async getReservedSubIndustryId(): Promise<string> {
    if (this.reservedSubIndustryId) return this.reservedSubIndustryId

    const RESERVED_NAME = '__personal_posts__'

    let subIndustry = await prisma.subIndustry.findFirst({
      where: { name: RESERVED_NAME },
    })

    if (!subIndustry) {
      let industry = await prisma.industry.findFirst({
        where: { name: '__system__' },
      })
      if (!industry) {
        industry = await prisma.industry.create({
          data: { name: '__system__' },
        })
      }
      subIndustry = await prisma.subIndustry.create({
        data: { name: RESERVED_NAME, industryId: industry.id },
      })
    }

    this.reservedSubIndustryId = subIndustry.id
    return subIndustry.id
  }

  private toHashtag(name: string): string {
    return name.replace(/[^a-zA-Z0-9]+/g, '')
  }

  // Turns the festival days picked out in generatePlan into MonthlyPost-shaped
  // rows: a Content row carrying the festival's name (tagged to the reserved
  // sub-industry, same as manual posts, so it can't leak into another user's
  // random draw) plus one of the festival's images picked at random. Every
  // festival post gets a default #Festival tag plus one derived from its name
  // (e.g. "Youth Day" -> #YouthDay).
  private async buildFestivalPosts(
    indexes: number[],
    days: Date[],
    dateKeys: string[],
    festivalByDate: Map<string, { event: string; images: { file: string; driveUrl: string | null }[] }>,
    subIndustryId: string,
  ) {
    if (!indexes.length) return []

    const reservedSubIndustryId = await this.getReservedSubIndustryId()

    // Dedupe tags across all festival days first so the upserts below never
    // race each other on the same unique `tag` value.
    const tags = new Set<string>(['Festival'])
    for (const i of indexes) tags.add(this.toHashtag(festivalByDate.get(dateKeys[i])!.event))

    const hashtags = await Promise.all(
      [...tags].map(tag =>
        prisma.hashtag.upsert({ where: { tag }, update: {}, create: { tag } }),
      ),
    )
    const hashtagIdByTag = new Map(hashtags.map(h => [h.tag, h.id]))

    return Promise.all(
      indexes.map(async i => {
        const festival = festivalByDate.get(dateKeys[i])!
        const image = festival.images[Math.floor(Math.random() * festival.images.length)]
        const eventTag = this.toHashtag(festival.event)

        const content = await prisma.content.create({
          data: { text: festival.event, subIndustryId: reservedSubIndustryId },
        })

        await prisma.contentHashtag.createMany({
          data: [hashtagIdByTag.get(eventTag)!, hashtagIdByTag.get('Festival')!]
            .filter((hashtagId, idx, arr) => arr.indexOf(hashtagId) === idx)
            .map(hashtagId => ({ contentId: content.id, hashtagId })),
        })

        return {
          type: 'FESTIVAL' as const,
          contentId: content.id,
          reelId: null,
          imageId: null,
          imageUrl: image.file || image.driveUrl,
          status: 'SCHEDULED' as const,
          postTime: days[i],
          subIndustryId,
        }
      }),
    )
  }

  // Keeps the most-recently-created post per calendar day for this user and deletes
  // any extras — guards against duplicate posts if generatePlan runs twice concurrently,
  // and against stale leftovers surviving alongside a freshly regenerated day.
  private async dedupePostsPerDay(userId: string): Promise<void> {
    await prisma.$executeRaw`
      DELETE FROM "CalendarPost" cp
      USING (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY "userId", date_trunc('day', "postTime")
          ORDER BY "createdAt" DESC
        ) AS rn
        FROM "CalendarPost"
        WHERE "userId" = ${userId}
      ) ranked
      WHERE cp.id = ranked.id AND ranked.rn > 1
    `
  }

 async generatePlan(
    userId: string,
    postTimeInput: string
  ) {
   // Independent reads — run together instead of one after another
   const [user, subscription] = await Promise.all([
     prisma.user.findUnique({
       where: { id: userId },
       select: { subIndustryId: true, timezone: true }
     }),
     prisma.subscription.findFirst({
       where: { userId, isActive: true, expiresAt: { gt: new Date() } },
     }),
   ])

   if (!user?.subIndustryId) {
     return {
       success: false,
       message: 'Please select an industry first.'
     }
   }

    if (!subscription) {
      return {
        success: false,
        message: 'Payment required. Please subscribe to a plan to continue.',
      }
    }

    const planType = 'PAID'
    const totalDays = 31

    const userTz = user.timezone || 'UTC'
    const [hours, minutes] = postTimeInput.split(':').map(Number)

    // Build each day's postTime in user's timezone, then convert to UTC
    const days = Array.from({ length: totalDays }, (_, i) => {
      const localDay = DateTime.now()
        .setZone(userTz)
        .plus({ days: i })
        .set({ hour: hours, minute: minutes, second: 0, millisecond: 0 })
        .toUTC()
        .toJSDate()
      return localDay
    })

    // Each day's calendar date in the user's own timezone — festival matching
    // is judged by the user's local date, not the UTC instant it's scheduled at.
    const dateKeys = days.map(d => DateTime.fromJSDate(d).setZone(userTz).toISODate()!)

    // Clear today onward — preserve only yesterday and earlier (already posted/handled).
    // Using the exact current instant here (instead of start-of-day) would leave today's
    // already-passed post un-deleted while still generating a fresh post for today too.
    // Runs alongside the festival lookup and generatePostsForMonth — none depend on
    // each other's result.
    const todayStart = DateTime.now().setZone(userTz).startOf('day').toUTC().toJSDate()
    const [, festivals] = await Promise.all([
      prisma.calendarPost.deleteMany({
        where: { userId, postTime: { gte: todayStart } },
      }),
      prisma.festival.findMany({
        where: {
          type: 'GLOBAL',
          date: {
            gte: new Date(`${dateKeys[0]}T00:00:00.000Z`),
            lte: new Date(`${dateKeys[dateKeys.length - 1]}T00:00:00.000Z`),
          },
        },
        include: { images: { where: { deletedAt: null } } },
      }),
    ])

    // Only festivals that actually have images qualify to replace a normal post.
    // If more than one lands on the same date, keep one at random.
    const festivalByDate = new Map<string, (typeof festivals)[number]>()
    for (const festival of festivals) {
      if (!festival.images.length) continue
      const key = festival.date.toISOString().slice(0, 10)
      if (!festivalByDate.has(key) || Math.random() < 0.5) {
        festivalByDate.set(key, festival)
      }
    }

    const festivalDayIndexes: number[] = []
    dateKeys.forEach((key, i) => {
      if (festivalByDate.has(key)) festivalDayIndexes.push(i)
    })
    const nonFestivalDays = days.filter((_, i) => !festivalByDate.has(dateKeys[i]))

    const [generatedPosts, festivalPosts] = await Promise.all([
      generatePostsForMonth(prisma, userId, nonFestivalDays, [user.subIndustryId]),
      this.buildFestivalPosts(festivalDayIndexes, days, dateKeys, festivalByDate, user.subIndustryId),
    ])

    const allPosts = [...generatedPosts, ...festivalPosts].sort(
      (a, b) => a.postTime.getTime() - b.postTime.getTime(),
    )

    if (!allPosts.length) {
      return {
        success: false,
        message: 'No posts available',
      }
    }

    // IDs are generated here (instead of letting Postgres default them) so the whole
    // batch can go in with one createMany() round trip instead of 31 individual creates.
    const rows = allPosts.map(post => ({
      id: randomUUID(),
      userId,
      subIndustryId: post.subIndustryId,
      contentId: post.contentId,
      reelId: post.reelId,
      imageId: post.imageId,
      imageUrl: post.imageUrl ?? '',
      type: post.type,
      postTime: post.postTime, // already UTC from days array
      status: post.status,
    }))

    try {
      await prisma.calendarPost.createMany({ data: rows })

      // Dedupe (safety net for a concurrent second call) and the relation re-fetch
      // don't depend on each other's result, so they run together.
      const [, postsWithRelations] = await Promise.all([
        this.dedupePostsPerDay(userId),
        // Re-fetch with relations so the response matches GET /calendar/plan's shape
        prisma.calendarPost.findMany({
          where: { id: { in: rows.map(r => r.id) } },
          orderBy: { postTime: 'asc' },
          include: {
            content: { include: { hashtags: { include: { hashtag: true } } } },
            reel: true,
            image: true,
          },
        }),
      ])

      return {
        success: true,
        message: 'Plan created successfully',
        planType,
        startPlan: days[0],
        meta: { totalPosts: postsWithRelations.length },
        posts: postsWithRelations.map(post => this.formatPost(post)),
      }
    } catch {
      return {
        success: false,
        message: 'Plan creation failed',
      }
    }
  }

async getPlanByUser(userId: string) {
  const [user, posts] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        connectedSocials: true
      }
    }),
    prisma.calendarPost.findMany({
      where: { userId },
      orderBy: { postTime: 'asc' },
      include: {
        content: {
          include: {
            hashtags: {
              include: {
                hashtag: true
              }
            }
          }
        },
        reel: true,
        image: true
      }
    })
  ])

  if (!posts.length) {
    return {
      success: false,
      message: 'No plan found for this user'
    }
  }

  const formattedPosts = posts.map(post => this.formatPost(post))

  return {
    success: true,
    meta: {
      totalPosts: posts.length,
      connectedSocials: user?.connectedSocials || []
    },
    posts: formattedPosts
  }
}



  async updatePost(
    userId: string,
    postId: string,
    body: { postTime?: string; status?: string; contentText?: string; reelId?: string; imageUrl?: string,timezone?: string },
    fileData?: { imageUrl: string; deleteUrl: string }
  ) {
    const post = await prisma.calendarPost.findUnique({
      where: { id: postId },
      include: { content: true, image: true }
    })

    if (!post || post.userId !== userId) {
      return { success: false, message: 'Post not found or unauthorized' }
    }

    // Detect whether this post is "manual" (created/last-edited as a personal
    // post) by checking if its current Content/Image already points at the
    // reserved sentinel sub-industry. If so, any new Content/Image rows this
    // edit creates get tagged with the sentinel too, keeping it isolated from
    // generatePlan's shared pool. Otherwise it's treated as a normal
    // auto-generated post and new rows are tagged with the post's real
    // sub-industry, same as before.
    // Caveat: a manual post with neither caption nor image yet has nothing to
    // check, so its first edit will be treated as non-manual by default.
    const reservedSubIndustryId = await this.getReservedSubIndustryId()
    const isManual =
      post.content?.subIndustryId === reservedSubIndustryId ||
      post.image?.subIndustryId === reservedSubIndustryId
    const targetSubIndustryId = isManual ? reservedSubIndustryId : post.subIndustryId

    let updatedData: any = {}

   if (body.postTime) {
     updatedData.postTime = DateTime
       .fromISO(body.postTime, { zone: body.timezone })
       .toUTC()
       .toISO()
   }
    if (body.status) updatedData.status = body.status
    if (body.reelId !== undefined) updatedData.reelId = body.reelId

    let imageData: { imageUrl: string; deleteUrl: string } | undefined
    if (body.imageUrl) {
      imageData = { imageUrl: body.imageUrl, deleteUrl: '' }
    } else if (fileData) {
      imageData = fileData
    }

    const operations: Array<Promise<{ id: string }>> = []

    if (body.contentText) {
      operations.push(
        prisma.content.create({
          data: { text: body.contentText, subIndustryId: targetSubIndustryId }
        })
      )
    }

    if (imageData) {
      operations.push(
        prisma.image.create({
          data: {
            file: imageData.imageUrl,
            deleteUrl: imageData.deleteUrl,
            text: false,
            subIndustryId: targetSubIndustryId
          }
        })
      )
    }

    if (operations.length) {
      const results = await Promise.all(operations)

      if (body.contentText) {
        const newContent = results.find(r => 'text' in r)
        if (newContent) updatedData.contentId = newContent.id
      }

      if (imageData) {
        const newImage = results.find(r => 'file' in r)
        if (newImage) {
          updatedData.imageId = newImage.id
          updatedData.imageUrl = imageData.imageUrl
          updatedData.type = 'IMAGE'
        }
      }
    }

    try {
      await prisma.calendarPost.update({
        where: { id: postId },
        data: updatedData
      })

      const postWithRelations = await prisma.calendarPost.findUnique({
        where: { id: postId },
        include: {
          content: { include: { hashtags: { include: { hashtag: true } } } },
          reel: true,
          image: true,
        },
      })

      return {
        success: true,
        message: 'Post updated',
        post: this.formatPost(postWithRelations)
      }
    } catch {
      throw new InternalServerErrorException('Failed to update post')
    }
  }
  
async getPostDetails(userId: string, postId: string) {
  const post = await prisma.calendarPost.findUnique({
    where: { id: postId },
    include: {
      content: {
        include: {
          hashtags: {
            include: { hashtag: true }
          }
        }
      },
      reel: true,
      image: true
    }
  })

  if (!post || post.userId !== userId) {
    throw new NotFoundException('Post not found or unauthorized')
  }

  return { success: true, post: this.formatPost(post) }
}

 async createPost(
    userId: string,
    body: { subIndustryId: string; postTime: string; contentText?: string; imageUrl?: string; timezone?: string },
    imageData?: { imageUrl: string; deleteUrl: string }
  ) {
    const { subIndustryId, postTime, contentText } = body

    let contentId: string | undefined
    let imageId: string | undefined
    let imageUrl: string | undefined

    const operations: any[] = []

    if (contentText) {
      operations.push(
        prisma.content.create({
          data: { text: contentText, subIndustryId }
        })
      )
    }

    if (imageData) {
      operations.push(
        prisma.image.create({
          data: {
            file: imageData.imageUrl,
            deleteUrl: imageData.deleteUrl,
            text: false,
            subIndustryId
          }
        })
      )
    }

    const results = operations.length ? await Promise.all(operations) : []

    if (contentText) {
      contentId = results[0]?.id
    }

    if (imageData) {
      const index = contentText ? 1 : 0
      imageId = results[index]?.id
      imageUrl = imageData.imageUrl
    }

    // Convert postTime (a full ISO datetime, in the user's local timezone) to UTC.
    // Matches updatePost's contract so callers can pick any date, not just today.
    const userTz = body.timezone || await this.getUserTimezone(userId)
    const utcPostTime = DateTime.fromISO(postTime, { zone: userTz }).toUTC().toJSDate()

    const post = await prisma.calendarPost.create({
      data: {
        userId,
        subIndustryId,
        contentId,
        imageId,
        imageUrl,
        type: 'IMAGE',
        postTime: utcPostTime,  // now stored as UTC
        status: 'SCHEDULED'
      }
    })

    // Re-fetch with relations so the response matches formatPost's shape
    // (same nested content/media structure as getPostDetails and getPlanByUser).
    const postWithRelations = await prisma.calendarPost.findUnique({
      where: { id: post.id },
      include: {
        content: { include: { hashtags: { include: { hashtag: true } } } },
        reel: true,
        image: true,
      },
    })

    return {
      success: true,
      message: 'Post created',
      post: this.formatPost(postWithRelations)
    }
  }

  // Publishes a calendar post right away instead of waiting for its scheduled
  // postTime. Reuses the exact same pipeline as the jobs module's scheduler:
  // lock the post to 'POSTING' then hand it to PostQueue, which PostWorker
  // (Outstand dispatch, status flip to POSTED/FAILED, Brevo email) already
  // processes almost immediately. This method just skips the "is it due yet"
  // check and the cron — everything after enqueue is identical.
  async publishNow(userId: string, postId: string) {
    const post = await prisma.calendarPost.findUnique({ where: { id: postId } })

    if (!post || post.userId !== userId) {
      return { success: false, message: 'Post not found or unauthorized' }
    }

    if (post.status !== 'SCHEDULED') {
      return {
        success: false,
        message: `Post cannot be published from status ${post.status}`,
      }
    }

    // Same locking pattern as jobs.service's checkDuePosts: flip to POSTING
    // conditionally so a concurrent request/cron tick can't double-enqueue it.
    const locked = await prisma.calendarPost.updateMany({
      where: { id: postId, status: 'SCHEDULED' },
      data: { status: 'POSTING' },
    })

    if (locked.count === 0) {
      return { success: false, message: 'Post is already being processed' }
    }

    await this.postQueue.addPublishJob(postId)

    return { success: true, message: 'Post is being published now' }
  }

  // User-only variant of createPost. Behaves the same (creates a Content row
  // for the caption and an Image row for the photo, same as createPost) except
  // it tags those rows with the reserved sentinel sub-industry instead of any
  // real one, so this personal post can never be pulled into another user's
  // auto-generated plan via generatePostsForMonth. The CalendarPost row itself
  // still carries the user's real subIndustryId, so it displays and reports
  // normally — only the underlying Content/Image rows are isolated.
  async createManualPost(
    userId: string,
    body: { postTime: string; contentText?: string; imageUrl?: string; timezone?: string },
    imageData?: { imageUrl: string; deleteUrl: string }
  ) {
    const { postTime, contentText } = body

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { subIndustryId: true },
    })

    if (!user?.subIndustryId) {
      return {
        success: false,
        message: 'Please select an industry first.',
      }
    }

    const reservedSubIndustryId = await this.getReservedSubIndustryId()

    let contentId: string | undefined
    let imageId: string | undefined
    let imageUrl: string | undefined

    const operations: any[] = []

    if (contentText) {
      operations.push(
        prisma.content.create({
          data: { text: contentText, subIndustryId: reservedSubIndustryId }
        })
      )
    }

    if (imageData) {
      operations.push(
        prisma.image.create({
          data: {
            file: imageData.imageUrl,
            deleteUrl: imageData.deleteUrl,
            text: false,
            subIndustryId: reservedSubIndustryId
          }
        })
      )
    }

    const results = operations.length ? await Promise.all(operations) : []

    if (contentText) {
      contentId = results[0]?.id
    }

    if (imageData) {
      const index = contentText ? 1 : 0
      imageId = results[index]?.id
      imageUrl = imageData.imageUrl
    }

    const userTz = body.timezone || await this.getUserTimezone(userId)
    const utcPostTime = DateTime.fromISO(postTime, { zone: userTz }).toUTC().toJSDate()

    const post = await prisma.calendarPost.create({
      data: {
        userId,
        subIndustryId: user.subIndustryId,
        contentId,
        imageId,
        imageUrl,
        type: 'IMAGE',
        postTime: utcPostTime,
        status: 'SCHEDULED'
      }
    })

    const postWithRelations = await prisma.calendarPost.findUnique({
      where: { id: post.id },
      include: {
        content: { include: { hashtags: { include: { hashtag: true } } } },
        reel: true,
        image: true,
      },
    })

    return {
      success: true,
      message: 'Post created',
      post: this.formatPost(postWithRelations)
    }
  }

  // User-only variant of updatePost. Same behavior, but Content/Image rows
  // created for the edit are tagged with the reserved sentinel sub-industry
  // instead of the post's real one — see createManualPost's comment above.
  async updateManualPost(
    userId: string,
    postId: string,
    body: { postTime?: string; status?: string; contentText?: string; reelId?: string; imageUrl?: string; timezone?: string },
    fileData?: { imageUrl: string; deleteUrl: string }
  ) {
    const post = await prisma.calendarPost.findUnique({ where: { id: postId } })

    if (!post || post.userId !== userId) {
      return { success: false, message: 'Post not found or unauthorized' }
    }

    const reservedSubIndustryId = await this.getReservedSubIndustryId()

    let updatedData: any = {}

    if (body.postTime) {
      updatedData.postTime = DateTime
        .fromISO(body.postTime, { zone: body.timezone })
        .toUTC()
        .toISO()
    }
    if (body.status) updatedData.status = body.status
    if (body.reelId !== undefined) updatedData.reelId = body.reelId

    let imageData: { imageUrl: string; deleteUrl: string } | undefined
    if (body.imageUrl) {
      imageData = { imageUrl: body.imageUrl, deleteUrl: '' }
    } else if (fileData) {
      imageData = fileData
    }

    const operations: Array<Promise<{ id: string }>> = []

    if (body.contentText) {
      operations.push(
        prisma.content.create({
          data: { text: body.contentText, subIndustryId: reservedSubIndustryId }
        })
      )
    }

    if (imageData) {
      operations.push(
        prisma.image.create({
          data: {
            file: imageData.imageUrl,
            deleteUrl: imageData.deleteUrl,
            text: false,
            subIndustryId: reservedSubIndustryId
          }
        })
      )
    }

    if (operations.length) {
      const results = await Promise.all(operations)

      if (body.contentText) {
        const newContent = results.find(r => 'text' in r)
        if (newContent) updatedData.contentId = newContent.id
      }

      if (imageData) {
        const newImage = results.find(r => 'file' in r)
        if (newImage) {
          updatedData.imageId = newImage.id
          updatedData.imageUrl = imageData.imageUrl
          updatedData.type = 'IMAGE'
        }
      }
    }

    try {
      await prisma.calendarPost.update({
        where: { id: postId },
        data: updatedData
      })

      const postWithRelations = await prisma.calendarPost.findUnique({
        where: { id: postId },
        include: {
          content: { include: { hashtags: { include: { hashtag: true } } } },
          reel: true,
          image: true,
        },
      })

      return {
        success: true,
        message: 'Post updated',
        post: this.formatPost(postWithRelations)
      }
    } catch {
      throw new InternalServerErrorException('Failed to update post')
    }
  }

}