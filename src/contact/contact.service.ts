import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { ContactMessage, ContactMessageStatus } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { RedisService } from '../common/redis/redis.service'
import { INQUIRY_TYPES, MESSAGES, RATE_LIMITS } from './contact.config'
import { validateContactInput } from './contact.validation'

// Thrown when a sender is over the limit; the controller turns retryAfterSeconds
// into the Retry-After header.
export class ContactRateLimitedException extends HttpException {
  constructor(public readonly retryAfterSeconds: number) {
    super({ success: false, error: MESSAGES.rateLimited }, HttpStatus.TOO_MANY_REQUESTS)
  }
}

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name)

  constructor(private readonly redisService: RedisService) {}

  async submit(body: unknown, ip: string) {
    const ipKey = `contact_rl:ip:${ip}`
    const ipAttempts = await this.checkRateLimit(ipKey, RATE_LIMITS.ip)
    await this.recordAttempt(ipKey, ipAttempts, RATE_LIMITS.ip.windowMs)

    const result = validateContactInput(body)
    if (!result.ok) {
      throw new BadRequestException({
        success: false,
        error: MESSAGES.validation,
        fieldErrors: result.fieldErrors,
      })
    }
    const input = result.value

    const emailKey = `contact_rl:email:${input.email}`
    const emailAttempts = await this.checkRateLimit(emailKey, RATE_LIMITS.email)

    let saved: ContactMessage
    try {
      saved = await prisma.$transaction(async (tx) => {
        const row = await tx.contactMessage.create({ data: input })
        return tx.contactMessage.update({
          where: { id: row.id },
          data: { reference: this.formatReference(row.seq, row.createdAt) },
        })
      })
    } catch (err) {
      this.logger.error(`Failed to save contact message: ${(err as Error).message}`)
      throw new InternalServerErrorException({ success: false, error: MESSAGES.serverError })
    }

    // Only count submissions that were actually saved against the email limit.
    await this.recordAttempt(emailKey, emailAttempts, RATE_LIMITS.email.windowMs)

    return {
      success: true,
      message: MESSAGES.success,
      data: {
        reference: saved.reference,
        inquiryType: saved.inquiryType,
        team: INQUIRY_TYPES[saved.inquiryType].team,
        createdAt: saved.createdAt,
      },
    }
  }

  // SH-2026-000123
  private formatReference(seq: number, createdAt: Date) {
    return `SH-${createdAt.getUTCFullYear()}-${String(seq).padStart(6, '0')}`
  }

  // Sliding-window limiter, same storage pattern as AuthService. Returns the
  // attempts in the window (null if Redis is unavailable: fail open so the
  // form keeps working) or throws when the limit is reached.
  private async checkRateLimit(key: string, limit: { max: number; windowMs: number }) {
    let attempts: number[]
    try {
      const stored = await this.redisService.getClient().get(key)
      const now = Date.now()
      attempts = stored ? JSON.parse(stored).filter((t: number) => now - t < limit.windowMs) : []
    } catch (err) {
      this.logger.warn(`Contact rate limiter unavailable: ${(err as Error).message}`)
      return null
    }

    if (attempts.length >= limit.max) {
      const retryAfter = Math.ceil((limit.windowMs - (Date.now() - Math.min(...attempts))) / 1000)
      throw new ContactRateLimitedException(Math.max(1, retryAfter))
    }
    return attempts
  }

  private async recordAttempt(key: string, attempts: number[] | null, windowMs: number) {
    if (!attempts) return
    attempts.push(Date.now())
    try {
      await this.redisService.getClient().set(key, JSON.stringify(attempts), { PX: windowMs })
    } catch (err) {
      this.logger.warn(`Contact rate limiter unavailable: ${(err as Error).message}`)
    }
  }

  // ── Admin ────────────────────────────────────────────────────────────────

  async findAll() {
    return prisma.contactMessage.findMany({
      orderBy: { createdAt: 'desc' },
    })
  }

  async findOne(id: string) {
    const contact = await prisma.contactMessage.findUnique({ where: { id } })
    if (!contact) throw new NotFoundException(`Contact ${id} not found`)
    return contact
  }

  async updateStatus(id: string, status: ContactMessageStatus) {
    await this.findOne(id)
    return prisma.contactMessage.update({
      where: { id },
      data: { status },
    })
  }

  // new / in_progress -> resolved, resolved -> new
  async toggleStatus(id: string) {
    const contact = await this.findOne(id)
    const newStatus =
      contact.status === ContactMessageStatus.resolved ? ContactMessageStatus.new : ContactMessageStatus.resolved
    return this.updateStatus(id, newStatus)
  }

  async remove(id: string) {
    await this.findOne(id)
    await prisma.contactMessage.delete({ where: { id } })
    return { message: 'Contact deleted successfully' }
  }
}
