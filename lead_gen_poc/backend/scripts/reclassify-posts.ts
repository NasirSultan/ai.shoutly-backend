// Dev helper: re-run the AI on posts already stored, after the classifier prompt
// changes. No Apify calls. For every search profile's cached query, the linked
// posts are re-scored with that profile's keywords, so both the post's own
// verdict (label, intent, sentiment) and its relevance to the query are updated.
// Usage: npm run reclassify
import 'dotenv/config'
import { prisma } from '../src/lib/prisma'
import { OpenRouterService } from '../src/lib/llm/openrouter.service'
import { LeadClassifierService } from '../src/lead-finder/lead-classifier.service'
import { FetchedPost } from '../src/lead-finder/lead-finder.types'
import { buildQueryKey } from '../src/lead-finder/query-key'

async function main() {
  const classifier = new LeadClassifierService(new OpenRouterService())
  const profiles = await prisma.searchProfile.findMany()

  // One pass per distinct cached query (profiles with the same scope share one).
  const queries = new Map<string, string[]>()
  for (const p of profiles) {
    for (const platform of p.platforms) queries.set(buildQueryKey(platform, p.keywords, p.subreddits), p.keywords)
  }

  let posts = 0
  let changed = 0
  for (const [queryKey, keywords] of queries) {
    const links = await prisma.leadPoolPost.findMany({ where: { queryKey }, include: { rawPost: true } })
    if (!links.length) continue
    console.log(`${queryKey}: ${links.length} posts`)

    const input: FetchedPost[] = links.map(({ rawPost: p }) => ({
      platform: p.platform,
      externalId: p.externalId,
      source: p.source,
      title: p.title,
      body: p.body,
      author: p.author,
      url: p.url,
      postedAt: p.postedAt,
      platformScore: p.platformScore,
      commentCount: p.commentCount,
    }))
    const analysed = await classifier.classify(input, keywords)

    for (const link of links) {
      const a = analysed.get(link.rawPost.externalId)
      if (!a) continue
      posts++
      if (a.classification !== link.rawPost.classification) changed++
      const { relevance, ...verdict } = a
      await prisma.socialRawPost.update({ where: { id: link.rawPostId }, data: verdict })
      await prisma.leadPoolPost.update({
        where: { queryKey_rawPostId: { queryKey, rawPostId: link.rawPostId } },
        data: { relevance },
      })
    }
  }
  console.log(`Done: ${posts} post scores updated, ${changed} changed label.`)
  console.log('New leads appear on the next "Get leads" for each profile.')
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
