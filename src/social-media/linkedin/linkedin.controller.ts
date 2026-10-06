import { Controller, Delete, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Response } from 'express';
import { AuthGuard } from '../../common/guards/auth.guard';
import { LinkedInService } from './linkedin.service';

@Controller('linkedin')
export class LinkedInController {
  constructor(
    private readonly linkedInService: LinkedInService,
    private readonly jwtService: JwtService,
  ) {}

  @UseGuards(AuthGuard)
  @Get('auth')
  getAuthUrl(@Req() req) {
    const userId = req.user.id;
    const token = req.headers.authorization?.split(' ')[1];
    const state = Buffer.from(JSON.stringify({ userId, token })).toString('base64');
    return { url: this.linkedInService.authUrl(state) };
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
      return res.redirect(`${done}?linkedin=error`);
    }

    let userId: string;
    try {
      const decoded = JSON.parse(Buffer.from(state, 'base64').toString('utf8'));
      userId = decoded.userId;
      this.jwtService.verify(decoded.token);
    } catch {
      return res.redirect(`${done}?linkedin=error`);
    }

    try {
      await this.linkedInService.connectFromCode(code, userId);
      return res.redirect(`${done}?linkedin=connected`);
    } catch {
      return res.redirect(`${done}?linkedin=error`);
    }
  }

  @UseGuards(AuthGuard)
  @Get('status')
  status(@Req() req) {
    return this.linkedInService.status(req.user.id);
  }

  @UseGuards(AuthGuard)
  @Delete()
  disconnect(@Req() req) {
    return this.linkedInService.disconnect(req.user.id);
  }
}
