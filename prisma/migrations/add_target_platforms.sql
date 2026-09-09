-- Add platform scoping for calendar publish/schedule (Gate G1)
-- Run: npx prisma db push   OR apply this SQL manually

ALTER TABLE "CalendarPost"
ADD COLUMN IF NOT EXISTS "targetPlatforms" "SocialPlatform"[] DEFAULT ARRAY[]::"SocialPlatform"[];
