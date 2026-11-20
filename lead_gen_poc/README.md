# Lead Finder POC (Reddit + Facebook)

Finds public Reddit and Facebook posts from people who want to hire or buy, and
scores each one with AI: lead label, intent score, match to your profile, and
sentiment (tone) with a reason. Built to the design in
`../shoutly-ai-reddit-lead-finder.pdf`, using the same stack and folder layout as
`ai.shoutly-backend` and `Shoulty-Ai` so it can be copied into them later.

```
lead_gen_poc/
  backend/    NestJS 10 + Prisma + BullMQ + Redis   (port 4100, prefix /api)
  frontend/   Next.js + Tailwind                     (port 3100)
  _old/       the previous Facebook-only POC, kept for reference
```

## Run it

Needs Docker Desktop and Node 20+.

```bash
cd backend
docker compose up -d          # Postgres on 5433, Redis on 6380
npm install
npx prisma db push            # creates the lead_finder_* tables
npm run build
npm start                     # http://localhost:4100/api/health
```

```bash
cd frontend
npm install
npm run dev                   # http://localhost:3100
```

`backend/.env` holds `APIFY_TOKEN` and `OPENROUTER_API_KEY` (copied from the old POC).
All settings are documented in `backend/.env.example`.

**Demo without Apify:** set `APIFY_MOCK=true` in `backend/.env` and restart. Posts then
come from `backend/samples/*.json` (real results saved from earlier runs). Run once
with `APIFY_SAVE_SAMPLES=true` to refresh those files from live searches.

## What is real and what is mocked

| Part | Status |
|---|---|
| Lead search on Reddit (Apify `red_crawler/reddit-search`, free) | Real |
| Lead search on Facebook (Apify `scraper_one/facebook-posts-search`, then `scrapeforge/facebook-search-posts`) | Real, but the free Apify tier rate-limits after a few runs |
| AI classification, intent, relevance, sentiment (OpenRouter) | Real |
| Cache-first flow, Redis lock, rate limits, BullMQ jobs, post dedup | Real |
| Leads feed: New / Replied / Dismissed, "Not a real lead", stale marker, cross-post merge | Real |
| Website analysis (`POST /search-profiles/crawl`) | **Mocked.** Real job + polling, but suggestions come from the domain name (`backend/src/search-profiles/mock-website-analysis.ts`) |
| Replying from the app, Reddit OAuth, email alerts | Left out of this round |
| Sign-in | None: every request acts as `LEAD_FINDER_DEMO_USER_ID` |

## How "Get leads" works (PDF section 2.2)

1. `POST /api/lead-finder/fetch { profileId }`, with a per-user rate limit (`LEAD_FINDER_USER_FETCHES_PER_MIN`).
2. For each platform on the profile, keywords (+ subreddits on Reddit) become a normalized
   `queryKey`. The key is the query, not the user, so users with the same search share results.
3. If `lead_finder_lead_pool` has the query from the last 30 minutes, leads are attached straight away, with no Apify or AI call.
4. Otherwise: `SET lock NX EX`. The lock holder enqueues a BullMQ job with a deterministic
   id, and anyone else gets the same job id to poll (`GET /api/lead-finder/fetch/:jobId?profileId=`).
5. The worker runs the Apify search (global hourly cap per platform), then skips posts it has
   already analysed for this query. It sends the rest to the AI in batches of 8, then writes posts, cache
   entry and links in one transaction, and releases the lock with a token check.
6. Only `GENUINE_LEAD` posts with intent ≥ `LEAD_FINDER_MIN_SCORE` and relevance ≥
   `LEAD_FINDER_MIN_RELEVANCE`, minus the profile's exclusion words, become the user's leads.
   A lead's status is never reset by a later match.
7. If Apify or the AI fails, the job fails (after one retry). The UI keeps the saved leads and shows
   "These results may be outdated".

**What the AI returns per post**
- **classification:** `genuine_lead` / `tangential_mention` / `discussion_only`.
- **intentScore** 0-100.
- **sentiment** `positive` / `neutral` / `negative`, with a short reason.
- **summary**, and **need** in a few words.
- **relevance** 0-100 to the query's keywords.

Everything except relevance describes the post itself and is stored once on the shared post.
Relevance is stored on the query↔post link, because one post can match one search and not another.
Post text is escaped and marked as untrusted data in the prompt (prompt-injection protection).

## API

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/search-profiles/crawl` | Start website analysis (mocked); same URL while running is reused |
| GET | `/api/search-profiles/crawl/:jobId` | Poll it |
| POST / GET | `/api/search-profiles` | Create / list profiles |
| GET / PATCH / DELETE | `/api/search-profiles/:id` | One profile |
| POST | `/api/lead-finder/fetch` | Get leads (cache-first) |
| GET | `/api/lead-finder/fetch/:jobId?profileId=` | Poll a fetch |
| GET | `/api/lead-finder/leads?status=&platform=&sentiment=&profileId=&sort=score\|newest` | Leads feed |
| PATCH | `/api/lead-finder/leads/:id` | `{ status }` or `{ notALead: true }` |

Routes are `/lead-finder/*` instead of the PDF's `/leads/*` because Shoutly already has a
`Lead` model and `/lead` routes for contact-form leads.

## Moving it into Shoutly later

**Backend (`ai.shoutly-backend`)**
- Copy `src/lead-finder/`, `src/search-profiles/`, `src/lib/apify/` and `src/lib/llm/` (OpenRouter client).
- Add `LeadFinderModule` and `SearchProfilesModule` to `AppModule`.
- `RedisService` and `prisma` are already the same as Shoutly's.
- Replace `DemoUserGuard` with `AuthGuard` in the two controllers. `req.user` already has the same shape.
- Paste the models and enums from `prisma/schema.prisma`, and add the `user` relations noted at the top of that file.
- Add the `LEAD_FINDER_*`, `APIFY_*` and `OPENROUTER_*` variables.

**Frontend (`Shoulty-Ai`)**
- Copy `app/dashboards/lead-finder/`, `components/lead-finder/` and `lib/api/leadFinderApi.ts`.
- Delete this POC's `lib/api/configApi.tsx` and `apiError.ts`. The imports then resolve to Shoutly's copies, which export the same names.
- Add a sidebar entry.

## Known limits
- **Search quality is set by the sources.** Reddit search is fuzzy, and Facebook keyword search returns many
  service ads from people selling their own work. The AI filters those out. Profiles with focused subreddits
  (`forhire`, `slavelabour`) and phrases like "hiring X" work best.
- **Job ads count as leads.** Full-time, part-time and contract job ads are classified as `genuine_lead`
  (a company hiring for the work is a prospect to pitch). The rule is in `SYSTEM_PROMPT` in
  `backend/src/lead-finder/lead-classifier.service.ts`. After changing the prompt, run
  `npm run reclassify` in `backend/` to re-score stored posts without new Apify calls.
- **Free models are unreliable.** OpenRouter free models were rate-limited or took minutes per call during testing, so
  the default list starts with `deepseek/deepseek-v4.1-flash` (paid, well under $0.001 per fetch)
  and falls back to free models.
- **Apify free tier:** the Facebook actors allow only a few runs per day.
