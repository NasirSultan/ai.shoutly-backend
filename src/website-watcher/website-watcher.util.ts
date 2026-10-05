// Website Watcher checks one website per user, never individual pages, so
// every address is reduced to its origin: "mybusiness.com/about?x=1" becomes
// "https://mybusiness.com".
export function toOrigin(raw: string): string | null {
  const value = raw?.trim()
  if (!value) return null
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (!url.hostname.includes('.')) return null
    return `${url.protocol}//${url.host}`
  } catch {
    return null
  }
}

// "https://www.mybusiness.com" and "https://mybusiness.com" are the same website.
export function sameWebsite(a: string, b: string): boolean {
  const host = (origin: string) => new URL(origin).hostname.replace(/^www\./, '')
  return host(a) === host(b)
}

export const TARGET_AUDIENCE_COUNT = 4

export interface WebsiteAnalysis {
  summary: string
  // 4 short audience names, each tied to a service the website offers,
  // e.g. "Businesses who want their logo on every post".
  targetAudiences: string[]
  changeSummary: string | null
}

const text = (value: unknown, max = 600) => (typeof value === 'string' ? value.trim().slice(0, max) : '')
const textList = (value: unknown, maxItems: number, maxLength = 120) =>
  Array.isArray(value) ? value.map((v) => text(v, maxLength)).filter(Boolean).slice(0, maxItems) : []

// Saved snapshots keep the audience names in the `audience` JSON column.
// Anything that isn't a list of names (e.g. an older format) counts as missing.
export function readTargetAudiences(stored: unknown): string[] | null {
  const names = textList(stored, TARGET_AUDIENCE_COUNT, 100)
  return names.length > 0 ? names : null
}

// The model's JSON is untrusted: keep only the expected fields, typed and
// size-limited, so the API response shape never depends on what it returned.
export function parseAnalysis(raw: string, expectChangeSummary: boolean): WebsiteAnalysis | null {
  let data: any
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  const summary = text(data?.summary, 1500)
  const targetAudiences = readTargetAudiences(data?.targetAudiences)
  if (!summary || !targetAudiences) return null

  return {
    summary,
    targetAudiences,
    changeSummary: expectChangeSummary ? text(data?.changeSummary, 1000) || null : null,
  }
}
