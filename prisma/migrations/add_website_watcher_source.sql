-- Website Watcher: lock each user to one way of analysing their business
-- (WEBSITE or DESCRIPTION). Additive only, safe to run more than once.
-- Run this BEFORE the code is deployed, or every User query will fail.
-- Do NOT use `npx prisma db push` on the shared database (it would drop InstagramAccount).
-- Run: npx prisma db execute --file prisma/migrations/add_website_watcher_source.sql --schema prisma/schema.prisma

DO $$ BEGIN
  CREATE TYPE "WatcherSource" AS ENUM ('WEBSITE', 'DESCRIPTION');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "watcherSource" "WatcherSource";

-- Existing users: lock them to the way they used first.
UPDATE "User" u
SET "watcherSource" = x.source::"WatcherSource"
FROM (
  SELECT "userId", (array_agg(src ORDER BY at))[1] AS source
  FROM (
    SELECT "userId", 'WEBSITE' AS src, MIN("createdAt") AS at
    FROM "WebsiteSnapshot"
    WHERE "userId" IS NOT NULL
    GROUP BY "userId"
    UNION ALL
    SELECT "userId", 'DESCRIPTION' AS src, "createdAt" AS at
    FROM "BusinessDescription"
  ) t
  GROUP BY "userId"
) x
WHERE u."id" = x."userId" AND u."watcherSource" IS NULL;
