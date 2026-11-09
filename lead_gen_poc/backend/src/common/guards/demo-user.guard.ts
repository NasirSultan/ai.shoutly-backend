import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'

// POC only: there is no sign-in, so every request acts as one fixed user.
// It sets req.user in the same shape as Shoutly's AuthGuard
// ({ id, email, role }), so at integration the controllers swap
// @UseGuards(DemoUserGuard) for @UseGuards(AuthGuard) and nothing else changes.
@Injectable()
export class DemoUserGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest()
    request.user = {
      id: process.env.LEAD_FINDER_DEMO_USER_ID || 'demo-user',
      email: 'demo@leadfinder.local',
      role: 'USER',
    }
    return true
  }
}
