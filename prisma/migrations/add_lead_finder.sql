-- Lead Finder: saved searches, shared post cache and each user's leads.
-- Additive only (new enums and lead_finder_* tables), safe to run more than once.
-- Run this BEFORE the code is deployed, or Lead Finder requests will fail.
-- Do NOT use `npx prisma db push` on the shared database (it would drop InstagramAccount).
-- Run: npx prisma db execute --file prisma/migrations/add_lead_finder.sql --schema prisma/schema.prisma

DO $$ BEGIN
  CREATE TYPE "LeadPlatform" AS ENUM ('REDDIT', 'FACEBOOK');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "LeadClassification" AS ENUM ('GENUINE_LEAD', 'TANGENTIAL_MENTION', 'DISCUSSION_ONLY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "LeadSentiment" AS ENUM ('POSITIVE', 'NEUTRAL', 'NEGATIVE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "FinderLeadStatus" AS ENUM ('NEW', 'REPLIED', 'DISMISSED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "lead_finder_search_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "summary" TEXT,
    "keywords" TEXT[],
    "subreddits" TEXT[],
    "exclusions" TEXT[],
    "platforms" "LeadPlatform"[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "lead_finder_search_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "lead_finder_raw_posts" (
    "id" TEXT NOT NULL,
    "platform" "LeadPlatform" NOT NULL,
    "externalId" TEXT NOT NULL,
    "source" TEXT,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "author" TEXT,
    "url" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3),
    "platformScore" INTEGER NOT NULL DEFAULT 0,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "dedupeKey" TEXT NOT NULL,
    "classification" "LeadClassification" NOT NULL,
    "intentScore" INTEGER NOT NULL,
    "sentiment" "LeadSentiment" NOT NULL,
    "sentimentReason" TEXT,
    "summary" TEXT,
    "need" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "lead_finder_raw_posts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "lead_finder_lead_pool" (
    "queryKey" TEXT NOT NULL,
    "platform" "LeadPlatform" NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "lead_finder_lead_pool_pkey" PRIMARY KEY ("queryKey")
);

CREATE TABLE IF NOT EXISTS "lead_finder_lead_pool_posts" (
    "queryKey" TEXT NOT NULL,
    "rawPostId" TEXT NOT NULL,
    "relevance" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "lead_finder_lead_pool_posts_pkey" PRIMARY KEY ("queryKey", "rawPostId")
);

CREATE TABLE IF NOT EXISTS "lead_finder_leads" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rawPostId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "status" "FinderLeadStatus" NOT NULL DEFAULT 'NEW',
    "score" INTEGER NOT NULL,
    "relevance" INTEGER NOT NULL DEFAULT 0,
    "notALead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "lead_finder_leads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "lead_finder_lead_profiles" (
    "leadId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    CONSTRAINT "lead_finder_lead_profiles_pkey" PRIMARY KEY ("leadId", "profileId")
);

CREATE TABLE IF NOT EXISTS "lead_finder_api_usage" (
    "date" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "callCount" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "lead_finder_api_usage_pkey" PRIMARY KEY ("date", "endpoint")
);

CREATE INDEX IF NOT EXISTS "lead_finder_search_profiles_userId_idx" ON "lead_finder_search_profiles"("userId");
CREATE INDEX IF NOT EXISTS "lead_finder_raw_posts_fetchedAt_idx" ON "lead_finder_raw_posts"("fetchedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "lead_finder_raw_posts_platform_externalId_key" ON "lead_finder_raw_posts"("platform", "externalId");
CREATE INDEX IF NOT EXISTS "lead_finder_leads_userId_status_createdAt_idx" ON "lead_finder_leads"("userId", "status", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "lead_finder_leads_userId_rawPostId_key" ON "lead_finder_leads"("userId", "rawPostId");
CREATE UNIQUE INDEX IF NOT EXISTS "lead_finder_leads_userId_dedupeKey_key" ON "lead_finder_leads"("userId", "dedupeKey");

DO $$ BEGIN
  ALTER TABLE "lead_finder_search_profiles" ADD CONSTRAINT "lead_finder_search_profiles_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "lead_finder_lead_pool_posts" ADD CONSTRAINT "lead_finder_lead_pool_posts_queryKey_fkey"
    FOREIGN KEY ("queryKey") REFERENCES "lead_finder_lead_pool"("queryKey") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "lead_finder_lead_pool_posts" ADD CONSTRAINT "lead_finder_lead_pool_posts_rawPostId_fkey"
    FOREIGN KEY ("rawPostId") REFERENCES "lead_finder_raw_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "lead_finder_leads" ADD CONSTRAINT "lead_finder_leads_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "lead_finder_leads" ADD CONSTRAINT "lead_finder_leads_rawPostId_fkey"
    FOREIGN KEY ("rawPostId") REFERENCES "lead_finder_raw_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "lead_finder_lead_profiles" ADD CONSTRAINT "lead_finder_lead_profiles_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "lead_finder_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "lead_finder_lead_profiles" ADD CONSTRAINT "lead_finder_lead_profiles_profileId_fkey"
    FOREIGN KEY ("profileId") REFERENCES "lead_finder_search_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
