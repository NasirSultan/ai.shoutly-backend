import { Injectable, BadRequestException, NotFoundException,UnauthorizedException, InternalServerErrorException } from '@nestjs/common'
import { PrismaService } from '../lib/prisma.service'
import { generateOtp, addMinutesToDate } from '../common/utils/common.util'
import * as bcrypt from 'bcrypt'
import { UserRole } from './dto/register.dto'
import { JwtService } from '@nestjs/jwt'
import { JwtLibService } from 'src/lib/jwt/jwt.service'
import { RedisService } from '../common/redis/redis.service'
import { BrevoService } from 'src/brevo/brevo.service'
import { TwoFactorService } from './two-factor/two-factor.service'
import { AuditLogService } from '../audit-log/audit-log.service'

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService,
  private jwtService: JwtLibService,
      private redisService: RedisService,
        private brevoService: BrevoService,
          private twoFactorService: TwoFactorService,
            private auditLogService: AuditLogService

  ) {}

  // Shared Redis-backed rate limiting, same pattern as the original login() limiter.
  // "always" mode records every call (spam/abuse protection for costly actions like
  // sending emails); "on-failure" mode (used inline in login/2FA-verify) only records
  // failed attempts, so legitimate retries after a mistake aren't penalized.
  private async assertNotRateLimited(scope: string, identifier: string, maxAttempts: number, windowMs: number) {
    const client = this.redisService.getClient()
    const key = `${scope}:${identifier}`
    const now = Date.now()
    const stored = await client.get(key)
    const attempts: number[] = stored ? JSON.parse(stored).filter((t: number) => now - t < windowMs) : []

    if (attempts.length >= maxAttempts) {
      const earliest = Math.min(...attempts)
      const waitTime = Math.ceil((windowMs - (now - earliest)) / 1000)
      throw new BadRequestException(`Too many attempts. Try again in ${waitTime} seconds.`)
    }
    return { client, key, attempts }
  }

  private async recordRateLimitAttempt(client: ReturnType<RedisService['getClient']>, key: string, attempts: number[], windowMs: number) {
    attempts.push(Date.now())
    await client.set(key, JSON.stringify(attempts), { PX: windowMs })
  }

async register(name: string, email: string, role?: UserRole) {
  const { client, key, attempts } = await this.assertNotRateLimited('register_attempts', email, 5, 15 * 60 * 1000)
  await this.recordRateLimitAttempt(client, key, attempts, 15 * 60 * 1000)

  const existing = await this.prisma.user.findUnique({ where: { email } })
  if (existing) throw new BadRequestException('Email already exists')

  try {
    const otp = generateOtp()
    const otpExpiresAt = addMinutesToDate(new Date(), 10)

    const user = await this.prisma.user.create({
      data: {
        name,
        email,
        otp,
        otpExpiresAt,
        role: role || UserRole.USER
      }
    })

    await this.brevoService.sendOtpEmail(user.email, user.name, otp)

    this.auditLogService.log({
      actor: { id: user.id, email: user.email, name: user.name },
      action: 'USER_REGISTERED',
      targetType: 'User',
      targetId: user.id,
      after: { name: user.name, email: user.email, role: user.role },
    })

    return { message: 'OTP sent to email', email: user.email }
  } catch (error) {
    throw new InternalServerErrorException('Failed to register user')
  }
}



  async verifyOtp(email: string, otp: string) {
    const { client, key, attempts } = await this.assertNotRateLimited('verify_otp_attempts', email, 5, 15 * 60 * 1000)
    try {
      const user = await this.prisma.user.findUnique({ where: { email } })
      if (!user) throw new NotFoundException('User not found')
      if (user.otp !== otp) {
        await this.recordRateLimitAttempt(client, key, attempts, 15 * 60 * 1000)
        throw new BadRequestException('Invalid OTP')
      }
      if (!user.otpExpiresAt || user.otpExpiresAt < new Date())
        throw new BadRequestException('OTP expired')

      await this.prisma.user.update({
        where: { email },
        data: { otp: null, otpExpiresAt: null },
      })
      await client.del(key)
      return { message: 'OTP verified successfully' }
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error
      throw new InternalServerErrorException('Failed to verify OTP')
    }
  }

async setPassword(email: string, password: string) {
  try {
    const user = await this.prisma.user.findUnique({ where: { email } })
    if (!user) throw new NotFoundException('User not found')

    const hashedPassword = await bcrypt.hash(password, 10)

    await this.prisma.user.update({
      where: { email },
      data: { password: hashedPassword }
    })

    return { message: 'Password set successfully' }
  } catch (error) {
    if (error instanceof NotFoundException) throw error
    throw new InternalServerErrorException('Failed to set password')
  }
}

async updateProfile(email: string, profileData: any) {
  const user = await this.prisma.user.findUnique({ where: { email } })
  if (!user) throw new NotFoundException('User not found')

  const { email: _, ...updateData } = profileData

  const updated = await this.prisma.user.update({
    where: { email },
    data: updateData
  })

  try {
    await this.brevoService.sendWelcomeEmail(email, updated.name)
  } catch (emailError) {
    console.error('Welcome email failed:', emailError)
  }

  // Anchor the onboarding drip sequence (steps 2-7) to the same moment the
  // welcome email (step 1) goes out — but only once, so re-saving the
  // profile later doesn't restart the whole sequence.
  if (!updated.onboardingStartedAt) {
    await this.prisma.user.update({
      where: { email },
      data: { onboardingStartedAt: new Date() },
    })
  }

  return updated
}


async login(email: string, password: string) {
  const now = Date.now()
  const window = 60 * 1000
  const maxAttempts = 3
  const client = this.redisService.getClient()
  const key = `login_attempts:${email}`

  let attempts: number[] = []
  const stored = await client.get(key)
  if (stored) {
    attempts = JSON.parse(stored)
    attempts = attempts.filter(t => now - t < window)
  }

  if (attempts.length >= maxAttempts) {
    const earliest = Math.min(...attempts)
    const waitTime = Math.ceil((window - (now - earliest)) / 1000)
    throw new BadRequestException(`Too many login attempts. Try again in ${waitTime} seconds.`)
  }

  const user = await this.prisma.user.findUnique({ where: { email } })
  if (!user) throw new BadRequestException('Invalid email or password')
  if (!user.password) throw new BadRequestException('Invalid email or password')

  const isMatch = await bcrypt.compare(password, user.password)
  if (!isMatch) {
    attempts.push(now)
    await client.set(key, JSON.stringify(attempts), { PX: window })
    this.auditLogService.log({
      actor: { id: user.id, email: user.email, name: user.name },
      action: 'USER_LOGIN_FAILED',
      targetType: 'User',
      targetId: user.id,
    })
    throw new BadRequestException('Invalid email or password')
  }

  await client.del(key)

  this.auditLogService.log({
    actor: { id: user.id, email: user.email, name: user.name },
    action: 'USER_LOGIN_SUCCESS',
    targetType: 'User',
    targetId: user.id,
  })

  if (user.twoFactorEnabled) {
    const pendingToken = this.jwtService.sign(
      { sub: user.id, purpose: '2fa_pending' },
      { expiresIn: 5 * 60 },
    )
    return { requiresTwoFactor: true, pendingToken }
  }

  return this.issueTokens(user)
}

private async issueTokens(user: { id: string; email: string; role: string }) {
  const payload = { sub: user.id, email: user.email, role: user.role }
  const accessToken = this.jwtService.sign(payload, { expiresIn: 7 * 24 * 60 * 60 })
  const refreshToken = this.jwtService.sign(payload, { expiresIn: 30 * 24 * 60 * 60 })

  const updated = await this.prisma.user.update({
    where: { id: user.id },
    data: { refreshToken }
  })

  const { password: _, twoFactorSecret: __, ...userData } = updated
  return { accessToken, refreshToken, user: userData }
}

async verifyTwoFactorLogin(pendingToken: string, code: string) {
  const now = Date.now()
  const window = 60 * 1000
  const maxAttempts = 5
  const client = this.redisService.getClient()

  let payload: any
  try {
    payload = this.jwtService.verify(pendingToken)
  } catch {
    throw new UnauthorizedException('Invalid or expired login session, please log in again')
  }
  if (payload.purpose !== '2fa_pending' || !payload.sub) {
    throw new UnauthorizedException('Invalid login session')
  }

  const key = `2fa_attempts:${payload.sub}`
  let attempts: number[] = []
  const stored = await client.get(key)
  if (stored) {
    attempts = JSON.parse(stored).filter((t: number) => now - t < window)
  }
  if (attempts.length >= maxAttempts) {
    const earliest = Math.min(...attempts)
    const waitTime = Math.ceil((window - (now - earliest)) / 1000)
    throw new BadRequestException(`Too many attempts. Try again in ${waitTime} seconds.`)
  }

  const isValid = await this.twoFactorService.verifyLoginCode(payload.sub, code)
  if (!isValid) {
    attempts.push(now)
    await client.set(key, JSON.stringify(attempts), { PX: window })
    throw new UnauthorizedException('Invalid two-factor code')
  }
  await client.del(key)

  const user = await this.prisma.user.findUnique({ where: { id: payload.sub } })
  if (!user) throw new NotFoundException('User not found')

  return this.issueTokens(user)
}



async refreshToken(token: string) {
  let payload: any
  try {
    payload = this.jwtService.verify(token)
  } catch {
    throw new UnauthorizedException('Invalid refresh token')
  }

  const user = await this.prisma.user.findUnique({ where: { id: payload.sub } })
  if (!user || user.refreshToken !== token) throw new UnauthorizedException('Invalid refresh token')

  const newPayload = { sub: user.id, email: user.email, role: user.role }

  const accessTokenExpires = 7 * 24 * 60 * 60
  const refreshTokenExpires = 30 * 24 * 60 * 60

  const accessToken = this.jwtService.sign(newPayload, { expiresIn: accessTokenExpires })
  const refreshToken = this.jwtService.sign(newPayload, { expiresIn: refreshTokenExpires })

  await this.prisma.user.update({
    where: { id: user.id },
    data: { refreshToken }
  })

  return { accessToken, refreshToken }
}

async sendOtp(email: string) {
  const { client, key, attempts } = await this.assertNotRateLimited('send_otp_attempts', email, 5, 15 * 60 * 1000)
  await this.recordRateLimitAttempt(client, key, attempts, 15 * 60 * 1000)

  const user = await this.prisma.user.findUnique({ where: { email } })
  if (user) {
    const otp = generateOtp()
    const otpExpiresAt = addMinutesToDate(new Date(), 10)

    await this.prisma.user.update({
      where: { email },
      data: { otp, otpExpiresAt }
    })

    await this.brevoService.sendOtpEmail(user.email, user.name, otp)
  }

  return { message: "If that email is registered, we've sent a verification code." }
}

  async verifyOtpForReset(email: string, otp: string) {
    const { client, key, attempts } = await this.assertNotRateLimited('verify_otp_reset_attempts', email, 5, 15 * 60 * 1000)

    const user = await this.prisma.user.findUnique({ where: { email } })
    if (!user) throw new NotFoundException('User not found')
    if (user.otp !== otp) {
      await this.recordRateLimitAttempt(client, key, attempts, 15 * 60 * 1000)
      throw new BadRequestException('Invalid OTP')
    }
    if (!user.otpExpiresAt || user.otpExpiresAt < new Date()) throw new BadRequestException('OTP expired')

    await this.prisma.user.update({
      where: { email },
      data: { otp: null, otpExpiresAt: null }
    })
    await client.del(key)

    return { message: 'OTP verified successfully' }
  }

  async resetPassword(email: string, password: string) {
    const { client, key, attempts } = await this.assertNotRateLimited('reset_password_attempts', email, 5, 15 * 60 * 1000)
    await this.recordRateLimitAttempt(client, key, attempts, 15 * 60 * 1000)

    const user = await this.prisma.user.findUnique({ where: { email } })
    if (!user) throw new NotFoundException('User not found')

    const hashedPassword = await bcrypt.hash(password, 10)
    await this.prisma.user.update({
      where: { email },
      data: { password: hashedPassword }
    })

    this.auditLogService.log({
      actor: { id: user.id, email: user.email, name: user.name },
      action: 'USER_PASSWORD_RESET',
      targetType: 'User',
      targetId: user.id,
    })

    return { message: 'Password reset successfully' }
  }

}
