import { Injectable } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const LIMIT = 9
const MAX_TOTAL = 60

interface PostRow {
  imageId: string
  imageUrl: string
  subIndustryId: string
  contentId: string
  text: string
  hashtags: string
}

const LATERAL_SELECT = `
  SELECT
    i.id::text          AS "imageId",
    i.file              AS "imageUrl",
    i."subIndustryId"   AS "subIndustryId",
    c.id::text          AS "contentId",
    c.ctxt              AS "text",
    c.hashtags          AS "hashtags"
  FROM "Image" i
  CROSS JOIN LATERAL (
    SELECT
      ct.id,
      ct."text" AS ctxt,
      COALESCE(
        (SELECT STRING_AGG(h.tag, ',')
         FROM "ContentHashtag" ch
         JOIN "Hashtag" h ON h.id = ch."hashtagId"
         WHERE ch."contentId" = ct.id),
        ''
      ) AS hashtags
    FROM "Content" ct
    WHERE ct."subIndustryId" = i."subIndustryId"
    ORDER BY RANDOM()
    LIMIT 1
  ) c
  WHERE i."deletedAt" IS NULL
`

@Injectable()
export class PostsService {
  async getPosts(opts: { page: number; subIndustryId?: string }) {
    const { page, subIndustryId } = opts
    const offset = Math.min((page - 1) * LIMIT, MAX_TOTAL - LIMIT)

    if (subIndustryId) {
      const countRows = await prisma.$queryRawUnsafe<[{ count: string }]>(
        `SELECT COUNT(*)::text AS count
         FROM "Image" i
         WHERE i."deletedAt" IS NULL
           AND i."subIndustryId" = $1
           AND EXISTS (SELECT 1 FROM "Content" ct WHERE ct."subIndustryId" = i."subIndustryId")`,
        subIndustryId,
      )
      const total = Math.min(parseInt(countRows[0].count), MAX_TOTAL)
      const totalPages = Math.ceil(total / LIMIT)

      const rows = await prisma.$queryRawUnsafe<PostRow[]>(
        `${LATERAL_SELECT} AND i."subIndustryId" = $1 ORDER BY RANDOM() LIMIT $2 OFFSET $3`,
        subIndustryId,
        LIMIT,
        offset,
      )

      return { data: this.mapRows(rows), meta: { total, page, limit: LIMIT, totalPages } }
    }

    // No subIndustryId: pick up to 6 random subIndustries that have both images and content
    const subRows = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM (
         SELECT DISTINCT i."subIndustryId" AS id
         FROM "Image" i
         WHERE i."deletedAt" IS NULL
           AND EXISTS (SELECT 1 FROM "Content" ct WHERE ct."subIndustryId" = i."subIndustryId")
       ) sub
       ORDER BY RANDOM()
       LIMIT 6`,
    )
    const ids = subRows.map((r) => r.id)
    if (ids.length === 0) {
      return { data: [], meta: { total: 0, page, limit: LIMIT, totalPages: 0 } }
    }

    const inClause = ids.map((_, i) => `$${i + 1}`).join(',')

    const countRows = await prisma.$queryRawUnsafe<[{ count: string }]>(
      `SELECT COUNT(*)::text AS count
       FROM "Image" i
       WHERE i."deletedAt" IS NULL
         AND i."subIndustryId" IN (${inClause})
         AND EXISTS (SELECT 1 FROM "Content" ct WHERE ct."subIndustryId" = i."subIndustryId")`,
      ...ids,
    )
    const total = Math.min(parseInt(countRows[0].count), MAX_TOTAL)
    const totalPages = Math.ceil(total / LIMIT)

    const limitParam = `$${ids.length + 1}`
    const offsetParam = `$${ids.length + 2}`

    const rows = await prisma.$queryRawUnsafe<PostRow[]>(
      `${LATERAL_SELECT} AND i."subIndustryId" IN (${inClause}) ORDER BY RANDOM() LIMIT ${limitParam} OFFSET ${offsetParam}`,
      ...ids,
      LIMIT,
      offset,
    )

    return { data: this.mapRows(rows), meta: { total, page, limit: LIMIT, totalPages } }
  }

  private mapRows(rows: PostRow[]) {
    return rows.map((r) => ({
      ...r,
      hashtags: r.hashtags ? r.hashtags.split(',').map((t) => t.trim()).filter(Boolean) : [],
    }))
  }
}
