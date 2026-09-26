import type { Request } from 'express'
import { CONTACT_ALLOWED_ORIGINS } from '../contact/contact.config'

const defaultCors = {
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true
}

// The public contact form (POST /api/contact and its preflight) only accepts
// the marketing site's origins; every other route keeps defaultCors.
const contactFormCors = {
  origin: CONTACT_ALLOWED_ORIGINS,
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}

export function corsOptionsDelegate(req: Request, callback: (err: Error | null, options: object) => void) {
  const path = (req.url ?? '').split('?')[0].replace(/\/+$/, '')
  const method =
    req.method === 'OPTIONS' ? req.headers['access-control-request-method'] : req.method
  callback(null, path === '/api/contact' && method === 'POST' ? contactFormCors : defaultCors)
}
