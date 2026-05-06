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
  pageName: string,
  postedAt: string
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
    subject: 'Your post is live on ' + pageName,
    params: {
      userName,
      pageName,
      postedAt,
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

}