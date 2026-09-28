// Best-effort PII scrub — not exhaustive, a determined user could still leak
// PII in free text no pattern catches — but strips the common, easily
// matched cases (emails, phone numbers) before text leaves this service's
// trust boundary: a third-party trace export, or an answer that gets cached
// and later replayed to a *different* user.
const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.-]+/g
const PHONE_PATTERN = /\+?\d[\d\s().-]{7,}\d/g

export function redactPii(text: string): string {
  return text
    .replace(EMAIL_PATTERN, '[redacted-email]')
    .replace(PHONE_PATTERN, '[redacted-phone]')
}
