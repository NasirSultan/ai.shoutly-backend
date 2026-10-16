import { Controller, Delete, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Response } from 'express';
import { AuthGuard } from '../../common/guards/auth.guard';
import { XService } from './x.service';

@Controller('x')
export class XController {
  constructor(
    private readonly xService: XService,
    private readonly jwtService: JwtService,
  ) {}

  @UseGuards(AuthGuard)
  @Get('auth')
  async getAuthUrl(@Req() req) {
    const token = req.headers.authorization?.split(' ')[1] || '';
    const url = await this.xService.authUrl(req.user.id, token);
    return { url };
  }

  @Get('callback')
  async handleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') oauthError: string,
    @Res() res: Response,
  ) {
    const front = (process.env.FRONTEND_URL || 'https://shoutlyai.com').replace(/\/$/, '');
    const done = `${front}/dashboards/settings/accounts`;

    if (oauthError || !code || !state) {
      return res.redirect(`${done}?x=error`);
    }

    try {
      const pending = await this.xService.takePending(state);
      if (!pending) return res.redirect(`${done}?x=error`);
      this.jwtService.verify(pending.token);
      await this.xService.connectFromCode(code, pending.userId, pending.verifier);
      return res.redirect(`${done}?x=connected`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'X connection did not finish.';
      console.error('[X callback]', message);
      return res.redirect(`${done}?x=error&reason=${encodeURIComponent(message.slice(0, 180))}`);
    }
  }

  @UseGuards(AuthGuard)
  @Get('status')
  status(@Req() req) {
    return this.xService.status(req.user.id);
  }

  @UseGuards(AuthGuard)
  @Delete()
  disconnect(@Req() req) {
    return this.xService.disconnect(req.user.id);
  }
}
