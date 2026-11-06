import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Header, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthGuard } from '../../common/guards/auth.guard';
import { ConnectBlueskyDto } from '../../outstand/dto/connect-bluesky.dto';
import { BlueskyService } from './bluesky.service';
import { BlueskyOAuthService } from './bluesky-oauth.service';

@Controller('bluesky')
export class BlueskyController {
  constructor(
    private readonly blueskyService: BlueskyService,
    private readonly oauth: BlueskyOAuthService,
  ) {}

  // ── Public OAuth documents (atproto: client_id = this metadata URL) ──────
  @Get('client-metadata.json')
  @Header('Cache-Control', 'public, max-age=300')
  clientMetadata() {
    return this.oauth.clientMetadata();
  }

  @Get('jwks.json')
  @Header('Cache-Control', 'public, max-age=300')
  jwks() {
    return this.oauth.jwks();
  }

  // ── OAuth connect ────────────────────────────────────────────────────────
  // GET /api/bluesky/auth?handle=alice.bsky.social → { url } to redirect to.
  @UseGuards(AuthGuard)
  @Get('auth')
  async getAuthUrl(@Req() req, @Query('handle') handle: string) {
    const url = await this.blueskyService.authUrl(req.user.id, handle);
    return { url };
  }

  @Get('callback')
  async handleCallback(@Req() req: Request, @Res() res: Response) {
    const front = (process.env.FRONTEND_URL || 'https://shoutlyai.com').replace(/\/$/, '');
    const done = `${front}/dashboards/settings/accounts`;
    const params = new URLSearchParams(req.originalUrl.split('?')[1] || '');

    if (params.get('error')) {
      const reason = params.get('error') === 'access_denied' ? 'denied' : 'failed';
      return res.redirect(`${done}?bluesky=error&reason=${reason}`);
    }
    try {
      const { session, userId } = await this.oauth.callback(params);
      await this.blueskyService.connectFromOAuth(userId, session);
      return res.redirect(`${done}?bluesky=connected`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[Bluesky callback]', message);
      const reason = message === 'link_expired' ? 'expired' : 'failed';
      return res.redirect(`${done}?bluesky=error&reason=${reason}`);
    }
  }

  // ── App password (fallback) ─────────────────────────────────────────────
  @UseGuards(AuthGuard)
  @Post('connect')
  @HttpCode(HttpStatus.OK)
  connect(@Req() req, @Body() dto: ConnectBlueskyDto) {
    return this.blueskyService.connect(req.user.id, dto.handle, dto.appPassword);
  }

  @UseGuards(AuthGuard)
  @Get('status')
  status(@Req() req) {
    return this.blueskyService.status(req.user.id);
  }

  @UseGuards(AuthGuard)
  @Delete()
  disconnect(@Req() req) {
    return this.blueskyService.disconnect(req.user.id);
  }
}
