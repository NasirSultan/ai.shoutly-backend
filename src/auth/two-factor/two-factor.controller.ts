import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { TwoFactorService } from './two-factor.service';
import { AuthGuard } from '../../common/guards/auth.guard';

@Controller('auth/2fa')
@UseGuards(AuthGuard)
export class TwoFactorController {
  constructor(private readonly twoFactorService: TwoFactorService) {}

  @Post('setup')
  setup(@Req() req) {
    return this.twoFactorService.generateSetup(req.user.id);
  }

  @Post('verify')
  verify(@Req() req, @Body('code') code: string) {
    return this.twoFactorService.verifyAndEnable(req.user.id, code);
  }

  @Post('disable')
  disable(@Req() req, @Body('code') code: string) {
    return this.twoFactorService.disable(req.user.id, code);
  }
}
