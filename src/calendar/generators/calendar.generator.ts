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
  // const usedReels = new Set<string>()   // reels disabled for now
  const usedImages = new Set<string>()

  // const reels = await prisma.reel.findMany({
  //   where: { subIndustryId: { in: subIndustryIds } },
  // })

  // Flat queries run in parallel instead of nesting contents inside each image —
  // the nested include joins every image row against the full contents list of its
  // sub-industry (images × contents rows), which got much heavier once sub-industries
  // were bulk-populated with ~37 content rows each.
  const [images, contents] = await Promise.all([
    prisma.image.findMany({ where: { subIndustryId: { in: subIndustryIds } } }),
    prisma.content.findMany({ where: { subIndustryId: { in: subIndustryIds } } }),
  ])

  const contentsBySubIndustry = new Map<string, typeof contents>()
  for (const c of contents) {
    const list = contentsBySubIndustry.get(c.subIndustryId)
    if (list) list.push(c)
    else contentsBySubIndustry.set(c.subIndustryId, [c])
  }

  const getRandom = <T>(arr: T[]) =>
    arr[Math.floor(Math.random() * arr.length)]

  for (const day of days) {
    const subIndustryId = getRandom(subIndustryIds)

    // const availableReels = reels.filter(
    //   r =>
    //     r.subIndustryId === subIndustryId &&
    //     !usedReels.has(r.id)
    // )

    const availableImages = images.filter(
      i =>
        i.subIndustryId === subIndustryId &&
        !usedImages.has(i.id)
    )

    if (!availableImages.length) continue

    // Reels temporarily disabled — images only for now
    const type: 'IMAGE' = 'IMAGE'

    let reelId: string | null = null
    let imageId: string | null = null
    let contentId: string | null = null
    let media: any = null

    // if (type === 'REEL') {
    //   media = getRandom(availableReels)
    //   reelId = media.id
    //   usedReels.add(media.id)
    //   const content = media.subIndustry.contents.find(
    //     c => !usedContent.has(c.id)
    //   )
    //   if (content) usedContent.add(content.id)
    //   contentId = content?.id || null
    // } else {
      media = getRandom(availableImages)
      imageId = media.id
      usedImages.add(media.id)
      const content = (contentsBySubIndustry.get(media.subIndustryId) || []).find(
        c => !usedContent.has(c.id)
      )
      if (content) usedContent.add(content.id)
      contentId = content?.id || null
    // }

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