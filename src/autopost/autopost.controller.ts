import { Controller, Post, Body, Req, UseGuards } from '@nestjs/common';
import { AutopostService } from './autopost.service';
import { ConnectAccountDto } from './dto/connect-account.dto';
import { PublishPostDto } from './dto/publish-post.dto';
import { SchedulePostDto } from './dto/schedule-post.dto';
import { AuthGuard } from '../common/guards/auth.guard';
import { BadRequestException, InternalServerErrorException } from '@nestjs/common';

@Controller('autopost')
export class AutopostController {
  constructor(private readonly autopostService: AutopostService) {}

  @Post('connect')
  @UseGuards(AuthGuard)
  connectAccount(@Req() req, @Body() dto: ConnectAccountDto) {
    const userId = req.user.id;
    return this.autopostService.getConnectUrl(userId, dto);
  }

  @Post('publish')
  @UseGuards(AuthGuard)
  publishPost(@Req() req, @Body() dto: PublishPostDto) {
    const userId = req.user.id;
    return this.autopostService.publishImmediately(userId, dto);
  }

  @Post('schedule')
  @UseGuards(AuthGuard)
  schedulePost(@Req() req, @Body() dto: SchedulePostDto) {
    const userId = req.user.id;
    return this.autopostService.scheduleForLater(userId, dto);
  }

  @Post('webhook')
  webhookReceiver(@Body() payload: any) {
    return this.autopostService.handleIncomingWebhook(payload);
  }

  @Post('finalize-connection')
  async finalizeSocial(@Body() body: { sessionToken: string }) {
    if (!body.sessionToken) {
      throw new BadRequestException('Missing session token');
    }

    const outstandApiKey = "ost_DFRKRnqHLgDCZGDqYCXywbmkFQOnqNtBHhpyGpnkqFsIFkdCSycGcbkTOECKlnta";
    const outstandBaseUrl = 'https://api.outstand.so/v1';

    try {
      const pendingUrl = `${outstandBaseUrl}/social-accounts/pending/${body.sessionToken}`;
      const pendingResponse = await fetch(pendingUrl, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${outstandApiKey}` }
      });

      if (!pendingResponse.ok) {
        throw new BadRequestException('Invalid or expired Outstand session token.');
      }

      const resBody = await pendingResponse.json();
      const availablePages = resBody?.data?.availablePages;

      if (!Array.isArray(availablePages) || availablePages.length === 0) {
        throw new BadRequestException('No authorized Facebook pages found inside this session.');
      }

      const selectedPageIds = availablePages.map((page: any) => page.id);

      const finalizeUrl = `${outstandBaseUrl}/social-accounts/pending/${body.sessionToken}/finalize`;
      const finalizeResponse = await fetch(finalizeUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${outstandApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ selectedPageIds }),
      });

      const rawText = await finalizeResponse.text().catch(() => '');
      let finalizeData: any = {};

      try {
        finalizeData = JSON.parse(rawText);
      } catch {
        finalizeData = { success: finalizeResponse.ok, message: rawText };
      }

      if (!finalizeResponse.ok || finalizeData.success === false) {
        console.error('Outstand Finalize Submission Error Content:', finalizeData);
        throw new BadRequestException(finalizeData.message || 'Outstand rejected the account activation payload.');
      }

      return { success: true, data: finalizeData };

    } catch (error) {
      console.error('Error finalizing Outstand account:', error);
      if (error instanceof BadRequestException) throw error;
      throw new InternalServerErrorException('Handshake failed during account selection assembly');
    }
  }

  @Post('handle-callback')
  @UseGuards(AuthGuard)
  async handlePlatformCallback(@Req() req, @Body() body: {
    sessionToken?: string;
    account_id?: string;
    network_unique_id?: string;
    username?: string;
    network?: string;
  }) {
    const userId = req.user.id;

    if (body.sessionToken) {
      return this.autopostService.finalizeTwoStepConnection(userId, body.sessionToken);
    }

    if (body.account_id) {
      return this.autopostService.saveDirectConnection(userId, {
        outstandAccountId: body.account_id,
        networkUniqueId: body.network_unique_id ?? '',
        username: body.username ?? 'Unknown Account',
        platform: body.network ?? 'INSTAGRAM'
      });
    }

    throw new BadRequestException('Invalid callback state parameters provided.');
  }

  @Post('test-fetch-accounts')
  async getAllAccountsForTesting() {
    return this.autopostService.getAllAccountsDebug();
  }
}
