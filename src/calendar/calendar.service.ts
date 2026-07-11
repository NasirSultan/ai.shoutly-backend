import { Injectable,InternalServerErrorException ,NotFoundException} from '@nestjs/common'
import { CalendarPost } from '@prisma/client'
import { generatePostsForMonth } from './generators/calendar.generator'
import { DateTime } from 'luxon'
import { prisma } from '../lib/prisma'

@Injectable()
export class CalendarService {


  private toUTC(timeStr: string, timezone: string, baseDate?: Date): Date {
    const [hours, minutes] = timeStr.split(':').map(Number)
    const base = baseDate ? DateTime.fromJSDate(baseDate) : DateTime.now()

    return base
      .setZone(timezone)
      .set({ hour: hours, minute: minutes, second: 0, millisecond: 0 })
      .toUTC()
      .toJSDate()
  }

  private async getUserTimezone(userId: string): Promise<string> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    })
    return user?.timezone || 'UTC'
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
   const user = await prisma.user.findUnique({
     where: { id: userId },
     select: { subIndustryId: true, timezone: true }
   })

   if (!user?.subIndustryId) {
     return {
       success: false,
       message: 'Please select an industry first.'
     }
   }

    const subscription = await prisma.subscription.findFirst({
      where: { userId, isActive: true, expiresAt: { gt: new Date() } },
    })

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

    // Clear today onward — preserve only yesterday and earlier (already posted/handled).
    // Using the exact current instant here (instead of start-of-day) would leave today's
    // already-passed post un-deleted while still generating a fresh post for today too.
    const todayStart = DateTime.now().setZone(userTz).startOf('day').toUTC().toJSDate()
    await prisma.calendarPost.deleteMany({
      where: { userId, postTime: { gte: todayStart } },
    })

    const generatedPosts = await generatePostsForMonth(
      prisma,
      userId,
      days,
      [user.subIndustryId]
    )

    if (!generatedPosts.length) {
      return {
        success: false,
        message: 'No posts available',
      }
    }

    const operations = generatedPosts.map(post =>
      prisma.calendarPost.create({
        data: {
          userId,
          subIndustryId: post.subIndustryId,
          contentId: post.contentId,
          reelId: post.reelId,
          imageId: post.imageId,
          type: post.type,
          postTime: post.postTime, // already UTC from days array
          status: post.status,
        },
      })
    )

    let savedPosts: CalendarPost[]

    try {
      savedPosts = await prisma.$transaction(operations)

      // Safety net: if this ran concurrently with another call for the same user,
      // a day could end up with more than one post — auto-remove the extras.
      await this.dedupePostsPerDay(userId)

      return {
        success: true,
        message: 'Plan created successfully',
        planType,
        startPlan: days[0],
        totalPosts: savedPosts.length,
        posts: savedPosts,
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

  const formattedPosts = posts.map(post => ({
    postId: post.id,
    postTime: post.postTime,
    status: post.status,
    content: post.content ? {
      contentId: post.content.id,
      text: post.content.text,
      hashtags: post.content.hashtags.map(ch => `#${ch.hashtag.tag}`)
    } : null,
    media: post.imageUrl
      ? { type: 'IMAGE', id: post.imageId, file: post.imageUrl }
      : post.image
      ? { type: 'IMAGE', id: post.image.id, file: post.image.file }
      : post.reel
      ? { type: 'REEL', id: post.reel.id, file: post.reel.file }
      : null
  }))

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
    const post = await prisma.calendarPost.findUnique({ where: { id: postId } })

    if (!post || post.userId !== userId) {
      return { success: false, message: 'Post not found or unauthorized' }
    }

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
          data: { text: body.contentText, subIndustryId: post.subIndustryId }
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
            subIndustryId: post.subIndustryId
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
      const updatedPost = await prisma.calendarPost.update({
        where: { id: postId },
        data: updatedData
      })

      return {
        success: true,
        message: 'Post updated',
        post: updatedPost
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

const formattedPost = {
  postId: post.id,
  postTime: post.postTime,
  status: post.status,
  content: post.content
    ? {
        contentId: post.content.id,
        text: post.content.text,
        hashtags: post.content.hashtags.map(ch => `#${ch.hashtag.tag}`)
      }
    : null,
  media: post.imageUrl
    ? { type: 'IMAGE', id: post.imageId, file: post.imageUrl }
    : post.image
    ? { type: 'IMAGE', id: post.image.id, file: post.image.file }
    : post.reel
    ? { type: 'REEL', id: post.reel.id, file: post.reel.file }
    : null
}

  return { success: true, post: formattedPost }
}

 async createPost(
    userId: string,
    body: { subIndustryId: string; postTime: string; contentText?: string; imageUrl?: string },
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

    // Convert user's local time to UTC
    const userTz = await this.getUserTimezone(userId)
    const utcPostTime = this.toUTC(postTime, userTz)

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

    return {
      success: true,
      message: 'Post created',
      post
    }
  }


}