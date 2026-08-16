// Hardcoded link registry — URLs are exact strings, not knowledge to embed.
// Which link to show is decided by semantic search: tag a rag_document with
// metadata: { link, linkLabel } and whichever document the vector search
// ranks as the top match determines the CTA. No separate keyword rules.

export const BOT_LINKS = {
  home: 'https://shoutlyai.com/',
  how_it_works: 'https://shoutlyai.com/#generator',
  features: 'https://shoutlyai.com/shoutlyai-ai-content-generator.html',
  pricing: 'https://shoutlyai.com/pricing',
  sign_up: 'https://shoutlyai.com/sign-up',
  sign_in: 'https://shoutlyai.com/sign-in',
  demo: 'https://shoutlyai.com/shoutlyai-demo.html',
  contact: 'https://shoutlyai.com/contact-us',
  help_center: 'https://shoutlyai.com/help-center',
  comparisons: 'https://shoutlyai.com/compare/buffer-vs-shoutly-ai',
} as const

export interface Cta {
  label: string
  url: string
}

// Shown when retrieval found relevant context but that document has no
// metadata.link of its own.
export const PERSISTENT_CTA: Cta = {
  label: 'Start Free Trial',
  url: BOT_LINKS.sign_up,
}

// Shown when no relevant context was found at all (unrecognized question).
export const FALLBACK_CTA: Cta = {
  label: 'Contact Support',
  url: BOT_LINKS.contact,
}
