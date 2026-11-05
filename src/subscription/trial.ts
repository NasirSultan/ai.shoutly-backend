import { ForbiddenException } from "@nestjs/common";
import { addDays } from "date-fns";
import { prisma } from "../lib/prisma";

export const TRIAL_DAYS = 7;

// Platforms a free-trial user may connect. Lowercase, as used by the connect flows.
export const TRIAL_ALLOWED_PLATFORMS = ["x", "linkedin"];

// Only users who sign up from this date get a trial (on their first login).
// Older accounts are left as they were.
const TRIAL_LAUNCH_DATE = new Date("2026-11-05T00:00:00Z");

// Gives a new user their 7-day trial the first time they log in.
// Does nothing if the user already has (or had) any subscription, so it can
// safely run on every login.
export async function startTrialIfNew(userId: string, userCreatedAt: Date) {
  if (userCreatedAt < TRIAL_LAUNCH_DATE) return;

  const hasAny = await prisma.subscription.findFirst({ where: { userId }, select: { id: true } });
  if (hasAny) return;

  const now = new Date();
  await prisma.subscription.create({
    data: {
      userId,
      isTrial: true,
      startedAt: now,
      expiresAt: addDays(now, TRIAL_DAYS),
      isActive: true,
    },
  });
}

// True while the user's latest subscription is a trial (running or ended) and
// they have not paid yet. Paid users and old users with no subscription are not limited.
export async function isOnTrial(userId: string) {
  const latest = await prisma.subscription.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { isTrial: true },
  });
  return !!latest?.isTrial;
}

// Throws 403 if a trial user tries to connect a platform other than X or LinkedIn.
export async function assertPlatformAllowed(userId: string, platform: string) {
  if (TRIAL_ALLOWED_PLATFORMS.includes(platform.toLowerCase())) return;
  if (await isOnTrial(userId)) {
    throw new ForbiddenException(
      "Your free trial lets you connect only X and LinkedIn. Upgrade to connect this account.",
    );
  }
}
