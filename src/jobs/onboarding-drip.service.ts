import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { DateTime } from 'luxon'
import { prisma } from '../lib/prisma'
import { BrevoService } from '../brevo/brevo.service'

// Onboarding drip sequence: step 1 (welcome) fires immediately from
// auth.service.ts#updateProfile, which also stamps onboardingStartedAt.
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

  // Runs once a day; catches up on any step whose day-count has passed and
  // that hasn't been sent yet, so a missed run never skips a step.
  @Cron('0 9 * * *')
  async sendDueDripEmails() {
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
}
