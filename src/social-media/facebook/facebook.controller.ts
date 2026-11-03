import { Body, Controller, Delete, Get, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtService } from '@nestjs/jwt';
import { AuthGuard } from '../../common/guards/auth.guard';
import { FacebookService } from './facebook.service';

@Controller('facebook')
export class FacebookController {
  constructor(
    private readonly facebookService: FacebookService,
    private readonly jwtService: JwtService,
  ) {}

  @UseGuards(AuthGuard)
  @Get('auth')
  async getAuthUrl(@Req() req) {
    const token = req.headers.authorization?.split(' ')[1] || '';
    const url = await this.facebookService.authUrl(req.user.id, token);
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
      return res.redirect(`${done}?facebook=error`);
    }

    try {
      const pending = await this.facebookService.takePending(state);
      if (!pending) return res.redirect(`${done}?facebook=error`);
      this.jwtService.verify(pending.token);
      await this.facebookService.connectFromCode(code, pending.userId);
      return res.redirect(`${done}?facebook=connected`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Facebook connection did not finish.';
      console.error('[Facebook callback]', message);
      return res.redirect(`${done}?facebook=error&reason=${encodeURIComponent(message.slice(0, 180))}`);
    }
  }

  @UseGuards(AuthGuard)
  @Get('status')
  status(@Req() req) {
    return this.facebookService.status(req.user.id);
  }

  @UseGuards(AuthGuard)
  @Get('pages')
  getPages(@Req() req) {
    return this.facebookService.getPages(req.user.id);
  }

  // Chooses which connected Page posts go to.
  @UseGuards(AuthGuard)
  @Post('select-page')
  selectPage(@Req() req, @Body('pageId') pageId: string) {
    return this.facebookService.selectPage(req.user.id, pageId);
  }

  @UseGuards(AuthGuard)
  @Delete()
  disconnect(@Req() req) {
    return this.facebookService.disconnect(req.user.id);
  }

  @UseGuards(AuthGuard)
  @Post('direct-post')
  directPost(
    @Req() req,
    @Body() body: { message: string; title?: string; imageUrl?: string; hashtags?: string[] },
  ) {
    return this.facebookService.directPost({
      userId: req.user.id,
      message: body.message,
      title: body.title,
      imageUrl: body.imageUrl,
      hashtags: body.hashtags,
    });
  }
}
