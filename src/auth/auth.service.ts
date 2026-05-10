import { Injectable, BadRequestException, NotFoundException,UnauthorizedException, InternalServerErrorException } from '@nestjs/common'
import { PrismaService } from '../lib/prisma.service'
import { generateOtp, addMinutesToDate } from '../common/utils/common.util'
import * as bcrypt from 'bcrypt'
import { UserRole } from './dto/register.dto'
import { JwtService } from '@nestjs/jwt'
import { JwtLibService } from 'src/lib/jwt/jwt.service'
import { RedisService } from '../common/redis/redis.service'
import { BrevoService } from 'src/brevo/brevo.service'

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService,
  private jwtService: JwtLibService,
      private redisService: RedisService,
        private brevoService: BrevoService

  ) {}

async register(name: string, email: string, role?: UserRole) {
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

    return { message: 'OTP sent to email', email: user.email }
  } catch (error) {
    throw new InternalServerErrorException('Failed to register user')
  }
}



  async verifyOtp(email: string, otp: string) {
    try {
      const user = await this.prisma.user.findUnique({ where: { email } })
      if (!user) throw new NotFoundException('User not found')
      if (user.otp !== otp) throw new BadRequestException('Invalid OTP')
      if (!user.otpExpiresAt || user.otpExpiresAt < new Date())
        throw new BadRequestException('OTP expired')

      await this.prisma.user.update({
        where: { email },
        data: { otp: null, otpExpiresAt: null },
      })
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
  if (!user) throw new BadRequestException('User not found')
  if (!user.password) throw new BadRequestException('Password not set')

  const isMatch = await bcrypt.compare(password, user.password)
  if (!isMatch) {
    attempts.push(now)
    await client.set(key, JSON.stringify(attempts), { PX: window })
    throw new BadRequestException('Invalid credentials')
  }

  await client.del(key)

  const payload = { sub: user.id, email: user.email, role: user.role }
  const accessToken = this.jwtService.sign(payload, { expiresIn: 15 * 60 })
  const refreshToken = this.jwtService.sign(payload, { expiresIn: 7 * 24 * 60 * 60 })

  await this.prisma.user.update({
    where: { id: user.id },
    data: { refreshToken }
  })

  const { password: _, ...userData } = user
  return { accessToken, refreshToken, user: userData }
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

  const accessTokenExpires = 15 * 60
  const refreshTokenExpires = 7 * 24 * 60 * 60

  const accessToken = this.jwtService.sign(newPayload, { expiresIn: accessTokenExpires })
  const refreshToken = this.jwtService.sign(newPayload, { expiresIn: refreshTokenExpires })

  await this.prisma.user.update({
    where: { id: user.id },
    data: { refreshToken }
  })

  return { accessToken, refreshToken }
}

async sendOtp(email: string) {
  const user = await this.prisma.user.findUnique({ where: { email } })
  if (!user) throw new NotFoundException('User not found')

  const otp = generateOtp()
  const otpExpiresAt = addMinutesToDate(new Date(), 10)

  await this.prisma.user.update({
    where: { email },
    data: { otp, otpExpiresAt }
  })

  await this.brevoService.sendOtpEmail(user.email, user.name, otp)

  return { message: 'OTP sent successfully' }
}

  async verifyOtpForReset(email: string, otp: string) {
    const user = await this.prisma.user.findUnique({ where: { email } })
    if (!user) throw new NotFoundException('User not found')
    if (user.otp !== otp) throw new BadRequestException('Invalid OTP')
    if (!user.otpExpiresAt || user.otpExpiresAt < new Date()) throw new BadRequestException('OTP expired')

    await this.prisma.user.update({
      where: { email },
      data: { otp: null, otpExpiresAt: null }
    })

    return { message: 'OTP verified successfully' }
  }

  async resetPassword(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } })
    if (!user) throw new NotFoundException('User not found')

    const hashedPassword = await bcrypt.hash(password, 10)
    await this.prisma.user.update({
      where: { email },
      data: { password: hashedPassword }
    })

    return { message: 'Password reset successfully' }
  }

}
