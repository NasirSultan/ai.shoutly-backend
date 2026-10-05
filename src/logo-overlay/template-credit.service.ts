import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import { prisma } from '../lib/prisma';
import { JwtLibService } from '../lib/jwt/jwt.service';
import { RedisService } from '../common/redis/redis.service';
import { BrevoService } from '../brevo/brevo.service';
import { generateOtp } from '../common/utils/common.util';
import { ApplyLogoService } from './apply-logo.service';

// Every email gets this many credits the first time it is verified.
export const WELCOME_CREDITS = 1;

const OTP_TTL_SECONDS = 10 * 60;
const CREDIT_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const CREDIT_TOKEN_PURPOSE = 'template-credit';
const RATE_WINDOW_MS = 15 * 60 * 1000;
const MAX_OTP_SENDS = 5;
const MAX_OTP_FAILURES = 5;

const normalizeEmail = (email: string) => email.trim().toLowerCase();
const hashOtp = (otp: string) => createHash('sha256').update(otp).digest('hex');

// Thrown inside the redeem transaction to roll back the credit deduction
// when another request already unlocked the same render.
class AlreadyUnlocked extends Error {}

@Injectable()
export class TemplateCreditService {
  private readonly logger = new Logger(TemplateCreditService.name);

  constructor(
    private readonly jwtLibService: JwtLibService,
    private readonly redisService: RedisService,
    private readonly brevoService: BrevoService,
    private readonly applyLogoService: ApplyLogoService,
  ) {}

  // Same sliding-window limiter as AuthService, keyed per email.
  private async hitRateLimit(scope: string, email: string, max: number, record: boolean) {
    const client = this.redisService.getClient();
    const key = `${scope}:${email}`;
    const now = Date.now();
    const stored = await client.get(key);
    const attempts: number[] = stored ? JSON.parse(stored).filter((t: number) => now - t < RATE_WINDOW_MS) : [];
    if (attempts.length >= max) {
      const wait = Math.ceil((RATE_WINDOW_MS - (now - Math.min(...attempts))) / 1000);
      throw new BadRequestException(`Too many attempts. Try again in ${wait} seconds.`);
    }
    if (record) {
      attempts.push(now);
      await client.set(key, JSON.stringify(attempts), { PX: RATE_WINDOW_MS });
    }
    return async () => {
      attempts.push(Date.now());
      await client.set(key, JSON.stringify(attempts), { PX: RATE_WINDOW_MS });
    };
  }

  private otpKey(email: string) {
    return `template-credit:otp:${email}`;
  }

  async sendOtp(rawEmail: string) {
    const email = normalizeEmail(rawEmail);
    await this.hitRateLimit('template_credit_otp_send', email, MAX_OTP_SENDS, true);

    const otp = generateOtp();
    await this.redisService.getClient().set(this.otpKey(email), hashOtp(otp), { EX: OTP_TTL_SECONDS });

    try {
      await this.brevoService.sendOtpEmail(email, email.split('@')[0], otp);
    } catch (error) {
      this.logger.error(`Failed to send template credit OTP to ${email}`, error as Error);
      throw new InternalServerErrorException('Could not send the verification code. Please try again.');
    }

    return { message: 'Verification code sent', email, expiresIn: OTP_TTL_SECONDS };
  }

  // Proves the user owns the email. A brand-new email gets its welcome credit here.
  async verifyOtp(rawEmail: string, otp: string) {
    const email = normalizeEmail(rawEmail);
    const recordFailure = await this.hitRateLimit('template_credit_otp_verify', email, MAX_OTP_FAILURES, false);

    const client = this.redisService.getClient();
    const stored = await client.get(this.otpKey(email));
    const supplied = Buffer.from(hashOtp(otp));
    if (!stored || stored.length !== supplied.length || !timingSafeEqual(Buffer.from(stored), supplied)) {
      await recordFailure();
      throw new BadRequestException('Invalid or expired code');
    }
    await client.del(this.otpKey(email));

    const balance = await this.ensureAccount(email);
    const creditToken = this.jwtLibService.sign(
      { purpose: CREDIT_TOKEN_PURPOSE, email },
      { expiresIn: CREDIT_TOKEN_TTL_SECONDS },
    );

    return { email, balance, creditToken, expiresIn: CREDIT_TOKEN_TTL_SECONDS };
  }

  // Creates the credit account with the welcome credit the first time an email
  // is seen. Returns the current balance either way.
  private async ensureAccount(email: string): Promise<number> {
    const existing = await prisma.templateCredit.findUnique({ where: { email } });
    if (existing) return existing.balance;

    try {
      const [account] = await prisma.$transaction([
        prisma.templateCredit.create({ data: { email, balance: WELCOME_CREDITS } }),
        prisma.templateCreditLog.create({ data: { email, change: WELCOME_CREDITS, reason: 'WELCOME' } }),
      ]);
      return account.balance;
    } catch {
      // Two first-time verifications raced; the other one created the account.
      const account = await prisma.templateCredit.findUniqueOrThrow({ where: { email } });
      return account.balance;
    }
  }

  private emailFromCreditToken(creditToken: string): string {
    let payload: { purpose?: string; email?: string };
    try {
      payload = this.jwtLibService.verify(creditToken);
    } catch {
      throw new ForbiddenException('Email verification expired. Please verify your email again.');
    }
    if (payload.purpose !== CREDIT_TOKEN_PURPOSE || !payload.email) {
      throw new ForbiddenException('Invalid credit token');
    }
    return payload.email;
  }

  async getBalance(creditToken: string) {
    const email = this.emailFromCreditToken(creditToken);
    const account = await prisma.templateCredit.findUnique({ where: { email } });
    return { email, balance: account?.balance ?? 0 };
  }

  // Spends one credit to unlock a render. 402 when the balance is 0, so the
  // frontend can fall back to the Razorpay checkout.
  async redeem(renderId: string, renderToken: string, creditToken: string) {
    this.applyLogoService.verifyRenderToken(renderId, renderToken);
    const email = this.emailFromCreditToken(creditToken);

    const alreadyPaid = await prisma.templatePurchase.findFirst({ where: { renderId, status: 'PAID' } });
    if (!alreadyPaid) {
      const imageUrl = await this.applyLogoService.getRenderImageUrl(renderId);
      if (!imageUrl) throw new ForbiddenException('Render expired. Please apply the template again.');

      try {
        await prisma.$transaction(async (tx) => {
          // Deducting first locks this email's credit row, so concurrent
          // redeems for the same email are serialized.
          const spent = await tx.templateCredit.updateMany({
            where: { email, balance: { gte: 1 } },
            data: { balance: { decrement: 1 } },
          });
          if (spent.count === 0) {
            throw new HttpException('No credits left. Please pay for this template.', HttpStatus.PAYMENT_REQUIRED);
          }

          const raced = await tx.templatePurchase.findFirst({ where: { renderId, status: 'PAID' } });
          if (raced) throw new AlreadyUnlocked();

          await tx.templatePurchase.create({
            data: { renderId, imageUrl, paidWith: 'CREDIT', email, amount: 0, status: 'PAID', paidAt: new Date() },
          });
          await tx.templateCreditLog.create({
            data: { email, change: -1, reason: 'TEMPLATE_USE', renderId },
          });
        });
      } catch (error) {
        if (!(error instanceof AlreadyUnlocked)) throw error;
      }
    }

    const account = await prisma.templateCredit.findUnique({ where: { email } });
    return {
      unlocked: true,
      balance: account?.balance ?? 0,
      downloadUrl: this.applyLogoService.paidDownloadUrl(renderId),
    };
  }

  // Admin: add credits to an email. A new email also gets its welcome credit.
  async grant(rawEmail: string, credits: number, adminId: string) {
    const email = normalizeEmail(rawEmail);
    await this.ensureAccount(email);

    const [account] = await prisma.$transaction([
      prisma.templateCredit.update({ where: { email }, data: { balance: { increment: credits } } }),
      prisma.templateCreditLog.create({ data: { email, change: credits, reason: 'ADMIN_GRANT', adminId } }),
    ]);

    return { email, balance: account.balance, added: credits };
  }

  async list(opts: { page: number; limit: number; search?: string }) {
    const where = opts.search ? { email: { contains: opts.search.toLowerCase() } } : {};
    const [total, rows] = await Promise.all([
      prisma.templateCredit.count({ where }),
      prisma.templateCredit.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (opts.page - 1) * opts.limit,
        take: opts.limit,
      }),
    ]);
    return {
      data: rows.map((r) => ({ email: r.email, balance: r.balance, createdAt: r.createdAt, updatedAt: r.updatedAt })),
      meta: { total, page: opts.page, limit: opts.limit, totalPages: Math.ceil(total / opts.limit) || 1 },
    };
  }

  async history(rawEmail: string) {
    const email = normalizeEmail(rawEmail);
    const [account, logs] = await Promise.all([
      prisma.templateCredit.findUnique({ where: { email } }),
      prisma.templateCreditLog.findMany({ where: { email }, orderBy: { createdAt: 'desc' }, take: 200 }),
    ]);
    return { email, balance: account?.balance ?? 0, history: logs };
  }
}
