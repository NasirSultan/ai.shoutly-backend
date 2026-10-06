import { Injectable, NestMiddleware } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'
import { MAX_BODY_BYTES, MESSAGES } from './contact.config'

// Rejects contact submissions over 20 KB. Uses Content-Length when present and
// falls back to the parsed body's size for chunked requests.
@Injectable()
export class ContactBodySizeMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const declared = Number(req.headers['content-length'])
    const size = Number.isFinite(declared)
      ? declared
      : Buffer.byteLength(JSON.stringify(req.body ?? {}))

    if (size > MAX_BODY_BYTES) {
      res.status(413).json({ success: false, error: MESSAGES.tooLarge })
      return
    }
    next()
  }
}
