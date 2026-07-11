// Mirrors the NEW generatePlan() logic exactly, to measure real wall-clock improvement.
const { PrismaClient } = require('@prisma/client')
const { DateTime } = require('luxon')
const { randomUUID } = require('crypto')
const prisma = new PrismaClient()

async function dedupePostsPerDay(userId) {
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

async function generatePostsForMonth(userId, days, subIndustryIds) {
  const posts = []
  const usedContent = new Set()
  const usedImages = new Set()

  const [images, contents] = await Promise.all([
    prisma.image.findMany({ where: { subIndustryId: { in: subIndustryIds } } }),
    prisma.content.findMany({ where: { subIndustryId: { in: subIndustryIds } } }),
  ])

  const contentsBySub = new Map()
  for (const c of contents) {
    const list = contentsBySub.get(c.subIndustryId)
    if (list) list.push(c); else contentsBySub.set(c.subIndustryId, [c])
  }

  const getRandom = (arr) => arr[Math.floor(Math.random() * arr.length)]

  for (const day of days) {
    const subIndustryId = getRandom(subIndustryIds)
    const availableImages = images.filter((i) => i.subIndustryId === subIndustryId && !usedImages.has(i.id))
    if (!availableImages.length) continue
    const media = getRandom(availableImages)
    usedImages.add(media.id)
    const content = (contentsBySub.get(media.subIndustryId) || []).find((c) => !usedContent.has(c.id))
    if (content) usedContent.add(content.id)
    posts.push({
      type: 'IMAGE', reelId: null, imageId: media.id, contentId: content?.id || null,
      subIndustryId, status: 'SCHEDULED', postTime: day,
    })
  }
  return posts
}

async function generatePlan(userId, postTimeInput) {
  const [user, subscription] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { subIndustryId: true, timezone: true } }),
    prisma.subscription.findFirst({ where: { userId, isActive: true, expiresAt: { gt: new Date() } } }),
  ])
  if (!user?.subIndustryId) return { success: false, message: 'Please select an industry first.' }
  if (!subscription) return { success: false, message: 'Payment required.' }

  const userTz = user.timezone || 'UTC'
  const [hours, minutes] = postTimeInput.split(':').map(Number)
  const days = Array.from({ length: 31 }, (_, i) =>
    DateTime.now().setZone(userTz).plus({ days: i }).set({ hour: hours, minute: minutes, second: 0, millisecond: 0 }).toUTC().toJSDate()
  )

  const todayStart = DateTime.now().setZone(userTz).startOf('day').toUTC().toJSDate()
  const [, generatedPosts] = await Promise.all([
    prisma.calendarPost.deleteMany({ where: { userId, postTime: { gte: todayStart } } }),
    generatePostsForMonth(userId, days, [user.subIndustryId]),
  ])

  if (!generatedPosts.length) return { success: false, message: 'No posts available' }

  const rows = generatedPosts.map((post) => ({ id: randomUUID(), userId, ...post }))

  await prisma.calendarPost.createMany({ data: rows })
  await dedupePostsPerDay(userId)
  const postsWithRelations = await prisma.calendarPost.findMany({
    where: { id: { in: rows.map((r) => r.id) } },
    orderBy: { postTime: 'asc' },
    include: { content: { include: { hashtags: { include: { hashtag: true } } } }, reel: true, image: true },
  })

  return { success: true, totalPosts: postsWithRelations.length }
}

async function main() {
  const subIndustry = await prisma.subIndustry.findFirst({
    where: { contents: { some: {} }, images: { some: {} } },
    select: { id: true, industryId: true, name: true },
  })

  const testUser = await prisma.user.create({
    data: {
      name: 'TMP bench-plan',
      email: `tmp-bench-plan-${Date.now()}@example.com`,
      subIndustryId: subIndustry.id,
      industryId: subIndustry.industryId,
      timezone: 'UTC',
    },
  })
  await prisma.subscription.create({
    data: { userId: testUser.id, plan: 'GROWTH', billing: 'MONTHLY', currency: 'USD', isActive: true, expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000) },
  })

  console.log(`Test user against sub-industry: ${subIndustry.name}`)
  console.time('generatePlan (NEW, optimized)')
  const result = await generatePlan(testUser.id, '10:00')
  console.timeEnd('generatePlan (NEW, optimized)')
  console.log(result)

  await prisma.calendarPost.deleteMany({ where: { userId: testUser.id } })
  await prisma.subscription.deleteMany({ where: { userId: testUser.id } })
  await prisma.user.delete({ where: { id: testUser.id } })
}

main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
