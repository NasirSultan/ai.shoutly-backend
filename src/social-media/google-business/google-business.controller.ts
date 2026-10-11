import { Body, Controller, Delete, Get, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { IsArray, IsString } from 'class-validator';
import { Response } from 'express';
import { AuthGuard } from '../../common/guards/auth.guard';
import { GoogleBusinessService } from './google-business.service';

class SelectLocationsDto {
  @IsArray()
  @IsString({ each: true })
  ids: string[];
}

@Controller('google-business')
export class GoogleBusinessController {
  constructor(
    private readonly googleBusinessService: GoogleBusinessService,
    private readonly jwtService: JwtService,
  ) {}

  @UseGuards(AuthGuard)
  @Get('auth')
  getAuthUrl(@Req() req) {
    const userId = req.user.id;
    const token = req.headers.authorization?.split(' ')[1];
    const state = Buffer.from(JSON.stringify({ userId, token })).toString('base64');
    return { url: this.googleBusinessService.authUrl(state) };
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
      return res.redirect(`${done}?google=error`);
    }

    let userId: string;
    try {
      const decoded = JSON.parse(Buffer.from(state, 'base64').toString('utf8'));
      userId = decoded.userId;
      this.jwtService.verify(decoded.token);
    } catch {
      return res.redirect(`${done}?google=error`);
    }

    try {
      await this.googleBusinessService.connectFromCode(code, userId);
      return res.redirect(`${done}?google=connected`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Google Business connection did not finish.';
      console.error('[Google Business callback]', message);
      return res.redirect(`${done}?google=error&reason=${encodeURIComponent(message.slice(0, 180))}`);
    }
  }

  @UseGuards(AuthGuard)
  @Get('status')
  status(@Req() req) {
    return this.googleBusinessService.status(req.user.id);
  }

  @UseGuards(AuthGuard)
  @Put('locations')
  selectLocations(@Req() req, @Body() body: SelectLocationsDto) {
    return this.googleBusinessService.selectLocations(req.user.id, body.ids || []);
  }

  @UseGuards(AuthGuard)
  @Delete()
  disconnect(@Req() req) {
    return this.googleBusinessService.disconnect(req.user.id);
  }
}
