// MOCK: stands in for "crawl the website + LLM business analysis" in the demo.
// The endpoint, job and polling are real; only this function is fake. Replace it
// with a crawler (home page + key pages) and an LLM call that returns the same shape.

export interface WebsiteAnalysis {
  suggestedName: string
  summary: string
  keywords: string[]
  subreddits: string[]
  exclusions: string[]
}

interface Template {
  match: RegExp
  label: string
  summary: (business: string) => string
  keywords: string[]
  subreddits: string[]
}

const COMMON_EXCLUSIONS = ['[for hire]', 'for hire', 'internship', 'my resume', 'unpaid']

const TEMPLATES: Template[] = [
  {
    match: /app|mobile|flutter|ios|android/,
    label: 'Mobile app leads',
    summary: (b) => `${b} builds mobile apps (iOS, Android, Flutter) for startups and small businesses.`,
    keywords: ['hiring app developer', 'need a flutter developer', 'looking for app developer', 'build an app for my business'],
    subreddits: ['forhire', 'FlutterDev', 'androiddev', 'startups', 'Entrepreneur'],
  },
  {
    match: /design|studio|creative|brand|logo/,
    label: 'Design leads',
    summary: (b) => `${b} is a design studio: logos, branding and UI/UX for small businesses.`,
    keywords: ['hiring graphic designer', 'need a logo designer', 'looking for graphic designer', 'need branding for my business'],
    subreddits: ['forhire', 'DesignJobs', 'logodesign', 'smallbusiness'],
  },
  {
    match: /market|seo|ads|social|media|growth|shout|digital/,
    label: 'Marketing leads',
    summary: (b) => `${b} offers digital marketing: social media management, SEO and paid ads.`,
    keywords: ['hiring social media manager', 'need help with social media marketing', 'looking for seo expert', 'need someone to run facebook ads'],
    subreddits: ['forhire', 'smallbusiness', 'marketing', 'Entrepreneur', 'SEO'],
  },
  {
    match: /.*/,
    label: 'Web development leads',
    summary: (b) => `${b} builds websites and web apps (WordPress, React/Next.js) for small businesses.`,
    keywords: ['hiring web developer', 'looking for web developer', 'need a website built', 'need help with my website'],
    subreddits: ['forhire', 'smallbusiness', 'webdev', 'Entrepreneur', 'slavelabour'],
  },
]

export function mockWebsiteAnalysis(normalizedUrl: string): WebsiteAnalysis {
  const host = new URL(normalizedUrl).hostname.replace(/^www\./, '')
  const name = host.split('.')[0]
  const business = name.charAt(0).toUpperCase() + name.slice(1)
  const t = TEMPLATES.find((tpl) => tpl.match.test(host))!
  return {
    suggestedName: t.label,
    summary: t.summary(business),
    keywords: [...t.keywords],
    subreddits: [...t.subreddits],
    exclusions: [...COMMON_EXCLUSIONS],
  }
}
