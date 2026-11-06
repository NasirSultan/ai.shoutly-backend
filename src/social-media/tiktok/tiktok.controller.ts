import { Controller, Delete, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { AuthGuard } from '../../common/guards/auth.guard';
import { TiktokService } from './tiktok.service';

@Controller('tiktok')
export class TiktokController {
  constructor(private readonly tiktokService: TiktokService) {}

  @UseGuards(AuthGuard)
  @Get('auth')
  async getAuthUrl(@Req() req) {
    const token = req.headers.authorization?.split(' ')[1] || '';
    const url = await this.tiktokService.authUrl(req.user.id, token);
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
    if (oauthError || !code || !state) return res.redirect(`${done}?tiktok=error`);
    try {
      const pending = await this.tiktokService.takePending(state);
      if (!pending) return res.redirect(`${done}?tiktok=error`);
      await this.tiktokService.connectFromCode(code, pending.userId);
      return res.redirect(`${done}?tiktok=connected`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'TikTok connection did not finish.';
      console.error('[TikTok callback]', message);
      return res.redirect(`${done}?tiktok=error&reason=${encodeURIComponent(message.slice(0, 180))}`);
    }
  }

  @UseGuards(AuthGuard)
  @Get('status')
  status(@Req() req) {
    return this.tiktokService.status(req.user.id);
  }

  @UseGuards(AuthGuard)
  @Get('creator')
  creator(@Req() req) {
    return this.tiktokService.creator(req.user.id);
  }

  @UseGuards(AuthGuard)
  @Delete()
  disconnect(@Req() req) {
    return this.tiktokService.disconnect(req.user.id);
  }
}
