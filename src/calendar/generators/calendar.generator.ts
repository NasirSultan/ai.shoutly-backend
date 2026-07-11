import { PrismaClient } from '@prisma/client'

type MonthlyPost = {
  type: 'REEL' | 'IMAGE'
  contentId: string | null
  reelId: string | null
  imageId: string | null
  status: 'SCHEDULED' | 'SKIP' | 'POSTED'
  postTime: Date
  subIndustryId: string
}

export async function generatePostsForMonth(
  prisma: PrismaClient,
  userId: string,
  days: Date[],
  subIndustryIds: string[]
): Promise<MonthlyPost[]> {
  const posts: MonthlyPost[] = []

  const usedContent = new Set<string>()
  const usedReels = new Set<string>()
  const usedImages = new Set<string>()

  const reels = await prisma.reel.findMany({
    where: { subIndustryId: { in: subIndustryIds } },
    include: { subIndustry: { include: { contents: true } } },
  })

  const images = await prisma.image.findMany({
    where: { subIndustryId: { in: subIndustryIds } },
    include: { subIndustry: { include: { contents: true } } },
  })

  const getRandom = <T>(arr: T[]) =>
    arr[Math.floor(Math.random() * arr.length)]

  for (const day of days) {
    const subIndustryId = getRandom(subIndustryIds)

    const availableReels = reels.filter(
      r =>
        r.subIndustryId === subIndustryId &&
        !usedReels.has(r.id)
    )

    const availableImages = images.filter(
      i =>
        i.subIndustryId === subIndustryId &&
        !usedImages.has(i.id)
    )

    if (!availableReels.length && !availableImages.length) continue

    let type: 'REEL' | 'IMAGE'
    if (availableReels.length && availableImages.length) {
      type = Math.random() < 0.5 ? 'REEL' : 'IMAGE'
    } else if (availableReels.length) {
      type = 'REEL'
    } else {
      type = 'IMAGE'
    }

    let reelId: string | null = null
    let imageId: string | null = null
    let contentId: string | null = null
    let media: any = null

    if (type === 'REEL') {
      media = getRandom(availableReels)
      reelId = media.id
      usedReels.add(media.id)
      const content = media.subIndustry.contents.find(
        c => !usedContent.has(c.id)
      )
      if (content) usedContent.add(content.id)
      contentId = content?.id || null
    } else {
      media = getRandom(availableImages)
      imageId = media.id
      usedImages.add(media.id)
      const content = media.subIndustry.contents.find(
        c => !usedContent.has(c.id)
      )
      if (content) usedContent.add(content.id)
      contentId = content?.id || null
    }

    posts.push({
      type,
      reelId,
      imageId,
      contentId,
      subIndustryId,
      status: 'SCHEDULED',
      postTime: day,
    })
  }

  return posts
}