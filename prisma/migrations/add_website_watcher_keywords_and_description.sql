-- Website Watcher: service keywords + business description
-- Additive only: adds 2 columns and 1 table, changes or deletes nothing else.
-- Do NOT use `npx prisma db push` on the shared database: it would also drop
-- the InstagramAccount table, which is not in this schema.
-- Run: npx prisma db execute --file prisma/migrations/add_website_watcher_keywords_and_description.sql --schema prisma/schema.prisma

ALTER TABLE "WebsiteSnapshot" ADD COLUMN IF NOT EXISTS "keywords" JSONB;

-- The user's own keyword list (max 8), editable via PUT /website-watcher/keywords.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "watcherKeywords" JSONB;

CREATE TABLE IF NOT EXISTS "BusinessDescription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "audience" JSONB NOT NULL,
    "keywords" JSONB NOT NULL,
    "analyzedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BusinessDescription_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BusinessDescription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "BusinessDescription_userId_key" ON "BusinessDescription"("userId");
