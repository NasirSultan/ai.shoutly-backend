import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { prisma } from '../../lib/prisma'

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest()
    const authHeader = request.headers.authorization
    if (!authHeader) throw new UnauthorizedException('No token provided')

    const token = authHeader.split(' ')[1]
    if (!token) throw new UnauthorizedException('Token malformed')

    try {
      const payload = this.jwtService.verify(token)
      if (!payload.sub || payload.purpose === '2fa_pending') {
        throw new UnauthorizedException('Full authentication required')
      }
      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: { isActive: true },
      })
      if (!user?.isActive) throw new UnauthorizedException('Account is inactive')
      // dynamically add user to request
      request.user = {
        id: payload.sub,
        email: payload.email,
        role: payload.role,
      }
      return true
    } catch (err) {
      throw new UnauthorizedException('Invalid token')
    }
  }
}
