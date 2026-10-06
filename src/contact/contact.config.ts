import { ContactInquiryType } from '@prisma/client'

export interface InquiryConfig {
  team: string
  // API value -> label shown on the form. First entry is the form's default.
  details: Record<string, string>
}

// One entry per tab of the "Send us a message" form on /contact-us.
export const INQUIRY_TYPES: Record<ContactInquiryType, InquiryConfig> = {
  sales: {
    team: 'Sales',
    details: { '1-10': '1–10', '11-50': '11–50', '51-200': '51–200', '200+': '200+' },
  },
  support: {
    team: 'Support',
    details: { free_trial: 'Free trial', monthly: 'Monthly', annual: 'Annual', agency: 'Agency' },
  },
  partner: {
    team: 'Partnerships',
    details: { agency: 'Agency', reseller: 'Reseller', affiliate: 'Affiliate', technology: 'Technology' },
  },
  press: {
    team: 'Press',
    details: { publication: 'Publication', podcast: 'Podcast', newsletter: 'Newsletter', other: 'Other' },
  },
}

// Origins allowed to call the public POST /api/contact (see main.ts CORS setup).
export const CONTACT_ALLOWED_ORIGINS = [
  'https://shoutlyai.com',
  'https://www.shoutlyai.com',
  'http://localhost:3000',
]

export const MAX_BODY_BYTES = 20 * 1024

export const RATE_LIMITS = {
  ip: { max: 5, windowMs: 10 * 60 * 1000 },
  email: { max: 3, windowMs: 60 * 60 * 1000 },
}

export const MESSAGES = {
  success: 'Thanks! Your message has been received.',
  validation: 'Please check the highlighted fields.',
  rateLimited: 'Too many messages. Please try again in a few minutes.',
  tooLarge: 'Your message is too long. Please shorten it and try again.',
  serverError:
    'Something went wrong sending your message. Please try again, or email hello@shoutlyai.com directly.',
}
