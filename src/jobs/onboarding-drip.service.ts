import { Injectable } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { DateTime } from 'luxon'
import { prisma } from '../lib/prisma'
import { BrevoService } from '../brevo/brevo.service'

// Onboarding drip sequence: step 1 (welcome) fires immediately from
// auth.service.ts#updateProfile. That same function is also supposed to
// stamp onboardingStartedAt, but in production that stamp was never
// landing (still 0/82 users weeks after the fix shipped) — so as a
// second, self-sufficient path, this job also starts the clock itself
// for anyone whose profile is clearly complete (brandName set) but whose
// clock never started. That way the drip doesn't depend on exactly which
// request handler saved the profile.
// Steps 2-7 below fire that many days after onboardingStartedAt.
const DRIP_STEPS: { step: number; days: number }[] = [
  { step: 2, days: 1 },
  { step: 3, days: 3 },
  { step: 4, days: 5 },
  { step: 5, days: 7 },
  { step: 6, days: 12 },
  { step: 7, days: 18 },
]

const MAX_DAYS = Math.max(...DRIP_STEPS.map((s) => s.days))

@Injectable()
export class OnboardingDripService {
  constructor(private readonly brevoService: BrevoService) {}

  // Runs every minute — same schedule as JobsService.checkDuePosts, so both
  // jobs share the same proven-reliable frequency on Render's free tier
  // instead of a single fixed daily time that's easy to miss entirely if
  // the app happens to be asleep at that exact moment. Safe to run this
  // often: each pass only sends a step that's both due AND not already in
  // sentOnboardingSteps, so catching up late is fine but nothing ever
  // fires twice for the same user/step.
  @Cron(CronExpression.EVERY_MINUTE)
  async sendDueDripEmails() {
    await this.startClockForCompletedProfiles()

    const now = DateTime.now()
    const windowStart = now.minus({ days: MAX_DAYS + 1 }).toJSDate()
    const windowEnd = now.minus({ days: DRIP_STEPS[0].days }).toJSDate()

    const users = await prisma.user.findMany({
      where: {
        onboardingStartedAt: { gte: windowStart, lte: windowEnd },
      },
      select: {
        id: true,
        email: true,
        name: true,
        onboardingStartedAt: true,
        sentOnboardingSteps: true,
      },
    })

    let sentCount = 0

    for (const user of users) {
      if (!user.onboardingStartedAt) continue

      const daysSinceStart = Math.floor(
        now.diff(DateTime.fromJSDate(user.onboardingStartedAt), 'days').days,
      )

      const dueSteps = DRIP_STEPS.filter(
        (s) => daysSinceStart >= s.days && !user.sentOnboardingSteps.includes(s.step),
      )

      for (const { step } of dueSteps) {
        try {
          await this.brevoService.sendOnboardingStepEmail(step, user.email, user.name)
          await prisma.user.update({
            where: { id: user.id },
            data: { sentOnboardingSteps: { push: step } },
          })
          sentCount++
        } catch (err) {
          console.error(`[OnboardingDrip] Step ${step} failed for ${user.email}:`, err)
        }
      }
    }

    if (sentCount > 0) {
      console.log(`[OnboardingDrip] Sent ${sentCount} drip email(s)`)
    }
  }

  // Anyone with a saved brand name has clearly finished the profile step,
  // regardless of which endpoint they went through. If their clock never
  // started, start it now so steps 2-7 aren't stuck forever.
  private async startClockForCompletedProfiles() {
    const { count } = await prisma.user.updateMany({
      where: { brandName: { not: null }, onboardingStartedAt: null },
      data: { onboardingStartedAt: new Date() },
    })

    if (count > 0) {
      console.log(`[OnboardingDrip] Started onboarding clock for ${count} user(s) with a completed profile`)
    }
  }
}
