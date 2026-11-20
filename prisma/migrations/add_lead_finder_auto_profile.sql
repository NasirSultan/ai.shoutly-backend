-- Lead Finder: one automatic search profile per user, built from the user's
-- industry and Website Analysis keywords (no more hand-made profiles).
-- Additive only (three new columns and one index), safe to run more than once.
-- Run this BEFORE the code is deployed, or Lead Finder requests will fail.
-- Do NOT use `npx prisma db push` on the shared database (it would drop InstagramAccount).
-- Run: npx prisma db execute --file prisma/migrations/add_lead_finder_auto_profile.sql --schema prisma/schema.prisma

ALTER TABLE "lead_finder_search_profiles" ADD COLUMN IF NOT EXISTS "auto" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "lead_finder_search_profiles" ADD COLUMN IF NOT EXISTS "topicKeywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "lead_finder_search_profiles" ADD COLUMN IF NOT EXISTS "industry" TEXT;

-- At most one automatic profile per user, even if two requests create it at once.
CREATE UNIQUE INDEX IF NOT EXISTS "lead_finder_search_profiles_one_auto_per_user"
  ON "lead_finder_search_profiles" ("userId") WHERE "auto" = true;
