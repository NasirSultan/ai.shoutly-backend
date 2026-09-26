import { ContactInquiryType } from '@prisma/client'
import { INQUIRY_TYPES } from './contact.config'

export interface ContactInput {
  inquiryType: ContactInquiryType
  name: string
  email: string
  phone: string | null
  detail: string
  message: string
}

export type FieldErrors = Partial<Record<keyof ContactInput, string>>

export type ValidationResult =
  | { ok: true; value: ContactInput }
  | { ok: false; fieldErrors: FieldErrors }

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_PATTERN = /^[0-9+\-() ]+$/

const tooLong = (max: number) => `Please keep this under ${max.toLocaleString('en-US')} characters.`

const hasOwn = (obj: object, key: string) => Object.prototype.hasOwnProperty.call(obj, key)

function isInquiryType(value: unknown): value is ContactInquiryType {
  return typeof value === 'string' && hasOwn(INQUIRY_TYPES, value)
}

// Validates the raw request body and collects every field error at once, so
// the form can highlight all problems in a single round trip.
export function validateContactInput(raw: unknown): ValidationResult {
  const body = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const fieldErrors: FieldErrors = {}
  const str = (key: string) => (typeof body[key] === 'string' ? (body[key] as string).trim() : '')

  const inquiryType = body.inquiryType
  if (!isInquiryType(inquiryType)) {
    fieldErrors.inquiryType = 'Please choose what this is about.'
  }

  const name = str('name')
  if (!name) fieldErrors.name = 'Please enter your name.'
  else if (name.length > 100) fieldErrors.name = tooLong(100)

  const email = str('email').toLowerCase()
  if (!email) fieldErrors.email = 'Please enter your email.'
  else if (email.length > 254) fieldErrors.email = tooLong(254)
  else if (!EMAIL_PATTERN.test(email)) fieldErrors.email = 'Please enter a valid email address.'

  let phone: string | null = null
  if (body.phone !== undefined && body.phone !== null) {
    if (typeof body.phone !== 'string') {
      fieldErrors.phone = 'Please enter a valid phone number.'
    } else {
      phone = body.phone.trim() || null
      if (phone && phone.length > 20) fieldErrors.phone = tooLong(20)
      else if (phone && (!PHONE_PATTERN.test(phone) || !/\d/.test(phone))) {
        fieldErrors.phone = 'Please enter a valid phone number.'
      }
    }
  }

  // Must be the API value (e.g. "1-10"), not the label ("1–10").
  const detail = typeof body.detail === 'string' ? body.detail : ''
  if (!detail || (isInquiryType(inquiryType) && !hasOwn(INQUIRY_TYPES[inquiryType].details, detail))) {
    fieldErrors.detail = 'Please choose an option.'
  }

  const message = str('message')
  if (!message) fieldErrors.message = 'Please enter your message.'
  else if (message.length > 5000) fieldErrors.message = tooLong(5000)

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors }

  return {
    ok: true,
    value: { inquiryType: inquiryType as ContactInquiryType, name, email, phone, detail, message },
  }
}
