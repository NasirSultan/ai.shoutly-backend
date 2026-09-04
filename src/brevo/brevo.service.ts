import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as Brevo from '@sendinblue/client'

@Injectable()
export class BrevoService {
  private apiInstance: Brevo.TransactionalEmailsApi

  constructor(private configService: ConfigService) {
    this.apiInstance = new Brevo.TransactionalEmailsApi()

    const apiKey = this.configService.get<string>('BREVO_API_KEY')

    if (apiKey) {
      this.apiInstance.setApiKey(
        Brevo.TransactionalEmailsApiApiKeys.apiKey,
        apiKey
      )
    }
  }

  async sendOtpEmail(toEmail: string, name: string, otp: string) {
    const senderEmail = this.configService.get<string>('BREVO_SENDER_EMAIL')
    const senderName = this.configService.get<string>('BREVO_SENDER_NAME')

    if (!senderEmail || !senderName) {
      throw new Error('Brevo sender config missing')
    }

    const digits = otp.split('')

    await this.apiInstance.sendTransacEmail({
      sender: {
        email: senderEmail,
        name: senderName
      },
      to: [{ email: toEmail, name }],
      subject: 'Your Verification Code',
      params: {
        name,
        otp1: digits[0],
        otp2: digits[1],
        otp3: digits[2],
        otp4: digits[3],
        otp5: digits[4],
        otp6: digits[5]
      },
      templateId: 1
    })
  }

  async sendPostPublishedEmail(
  toEmail: string,
  userName: string,
  platformRowsHtml: string,
) {
  const senderEmail = this.configService.get<string>('BREVO_SENDER_EMAIL')
  const senderName = this.configService.get<string>('BREVO_SENDER_NAME')

  if (!senderEmail || !senderName) {
    throw new Error('Brevo sender config missing')
  }

  await this.apiInstance.sendTransacEmail({
    sender: {
      email: senderEmail,
      name: senderName,
    },
    to: [{ email: toEmail, name: userName }],
    subject: 'Your ShoutlyAI post is now live!',
    params: {
      userName,
      platformRows: platformRowsHtml,
    },
    templateId: 3,
  })
}


async sendWelcomeEmail(toEmail: string, name: string) {
  const senderEmail = this.configService.get<string>('BREVO_SENDER_EMAIL')
  const senderName = this.configService.get<string>('BREVO_SENDER_NAME')

  if (!senderEmail || !senderName) {
    throw new Error('Brevo sender config missing')
  }

  await this.apiInstance.sendTransacEmail({
    sender: { email: senderEmail, name: senderName },
    to: [{ email: toEmail, name }],
    subject: 'Welcome to Shoutly AI!',
    params: { name },
    templateId: 4   // new template in Brevo dashboard
  })
}

// Day 1 → 18 onboarding drip. Keyed by step number (2-7) since step 1 is
// sendWelcomeEmail above; templateId/subject map to the Brevo templates
// created for the drip sequence.
private readonly onboardingSteps: Record<number, { templateId: number; subject: string }> = {
  2: { templateId: 5, subject: 'Connect Your Social Channels' },
  3: { templateId: 6, subject: 'Let Your AI Agent Create Your First Post' },
  4: { templateId: 7, subject: 'Stop Thinking About What to Post Every Day' },
  5: { templateId: 8, subject: "Your AI Agent Doesn't Just Post. It Can Listen Too" },
  6: { templateId: 9, subject: 'Your Social Media Should Do More Than Get Likes' },
  7: { templateId: 10, subject: "You've Set It Up. Now Put Shoutly AI to Work" },
}

async sendOnboardingStepEmail(step: number, toEmail: string, name: string) {
  const senderEmail = this.configService.get<string>('BREVO_SENDER_EMAIL')
  const senderName = this.configService.get<string>('BREVO_SENDER_NAME')

  if (!senderEmail || !senderName) {
    throw new Error('Brevo sender config missing')
  }

  const config = this.onboardingSteps[step]
  if (!config) {
    throw new Error(`Unknown onboarding step: ${step}`)
  }

  await this.apiInstance.sendTransacEmail({
    sender: { email: senderEmail, name: senderName },
    to: [{ email: toEmail, name }],
    subject: config.subject,
    params: { name },
    templateId: config.templateId,
  })
}

}