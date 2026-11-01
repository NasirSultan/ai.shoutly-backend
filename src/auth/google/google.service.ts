import { Injectable, BadRequestException } from '@nestjs/common'
import { OAuth2Client } from 'google-auth-library'
import { PrismaService } from '../../lib/prisma.service'
import { JwtService } from '@nestjs/jwt'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { UserSignedUpEvent } from '../../events/user-signed-up.event'

@Injectable()
export class GoogleService {
  private client: OAuth2Client

  constructor(private prisma: PrismaService, private jwtService: JwtService, private eventEmitter: EventEmitter2) {
    this.client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID)
  }

  async verifyGoogleToken(idToken: string) {
    try {
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID,
      })

      const payload = ticket.getPayload()
      if (!payload || !payload.email) {
        throw new BadRequestException('Invalid Google token')
      }

      return payload
    } catch (error) {
      throw new BadRequestException('Failed to verify Google token')
    }
  }

  async loginWithGoogle(idToken: string) {
    const payload = await this.verifyGoogleToken(idToken)
    if (!payload.email) throw new BadRequestException('Google account has no email')

    const existing = await this.prisma.user.findUnique({ where: { email: payload.email }, select: { id: true } })

    const user = await this.prisma.user.upsert({
      where: { email: payload.email },
      update: {
        name: payload.name || 'Google User',
      },
      create: {
        name: payload.name || 'Google User',
        email: payload.email,
        password: '',
      },
    })

    if (!existing) {
      this.eventEmitter.emit('user.signed-up', new UserSignedUpEvent(user.name, user.email, 'Google', new Date()))
    }

    const token = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
    })

    return { user, token }
  }
}