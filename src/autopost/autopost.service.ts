import { Injectable, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { PrismaClient, SocialPlatform, PostStatusBridge, DeliveryStatus } from '@prisma/client';
import { ConnectAccountDto } from './dto/connect-account.dto';
import { PublishPostDto } from './dto/publish-post.dto';
import { SchedulePostDto } from './dto/schedule-post.dto';
import axios from 'axios';

@Injectable()
export class AutopostService {
  private prisma = new PrismaClient();
  private readonly outstandApiKey = process.env.OUTSTAND_API_KEY!;
  private readonly outstandBaseUrl = process.env.OUTSTAND_BASE_URL!;
  private readonly outstandRedirectUri = process.env.OUTSTAND_REDIRECT_URI!;

  constructor() {
    if (!this.outstandApiKey) {
      console.warn('Warning: OUTSTAND_API_KEY is not defined in your environment variables.');
    }
  }

  async getConnectUrl(userId: string, dto: ConnectAccountDto) {
    try {
      console.log('Outstand Config:', { url: this.outstandBaseUrl, hasKey: !!this.outstandApiKey, platform: dto.platform });

      const response = await fetch(`${this.outstandBaseUrl}/social-networks/${dto.platform}/auth-url`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.outstandApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          redirect_uri: this.outstandRedirectUri,
          state: userId
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('Exact Outstand API Error Response:', errorData);
        throw new BadRequestException(errorData.message || 'Failed to fetch authorization URL from Outstand');
      }
      const resData = await response.json();
      console.log('Outstand Success Payload:', resData);
      return { redirectUrl: resData.data.auth_url };

    } catch (error) {
      console.error('Outstand connection error:', error);
      if (error instanceof BadRequestException) throw error;
      throw new InternalServerErrorException('Error contacting Outstand service layer');
    }
  }

  async publishImmediately(userId: string, dto: PublishPostDto) {
    const verifiedAccounts = await this.prisma.socialAccount.findMany({
      where: {
        userId,
        platform: { in: dto.platforms.map(p => p.toUpperCase()) as SocialPlatform[] },
      },
    });

    if (!verifiedAccounts.length) {
      throw new BadRequestException('No matching social accounts found for the given platforms');
    }

    const outstandAccountIds = verifiedAccounts.map((acc) => acc.outstandAccountId);

    const postRecord = await this.prisma.post.create({
      data: {
        userId,
        content: dto.content,
        status: PostStatusBridge.PROCESSING,
      },
    });

    const container: any = { content: dto.content };

    if (dto.mediaUrls && dto.mediaUrls.length > 0) {
      container.media = dto.mediaUrls.map((url) => ({
        url,
        type: url.endsWith('.mp4') ? 'video' : 'image',
        filename: url.substring(url.lastIndexOf('/') + 1) || 'default_file',
      }));
    }

    try {
      const response = await axios.post(
        `${this.outstandBaseUrl.trim()}/posts/`,
        {
          accounts: outstandAccountIds,
          containers: [container],
        },
        {
          headers: {
            'Authorization': `Bearer ${this.outstandApiKey.trim()}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        }
      );

      const outstandResult = response.data;

      await this.prisma.post.update({
        where: { id: postRecord.id },
        data: {
          status: PostStatusBridge.PUBLISHED,
          outstandPostId: outstandResult.data?.id,
        },
      });

      return { success: true, postId: postRecord.id, outstandPostId: outstandResult.data?.id };

    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        const remoteErrorData = error.response.data;

        console.error('--- OUTSTAND DETAILED ERROR RESPONSE ---');
        console.error(JSON.stringify(remoteErrorData, null, 2));
        console.error('----------------------------------------');

        await this.prisma.post.update({
          where: { id: postRecord.id },
          data: { status: PostStatusBridge.FAILED },
        });

        throw new BadRequestException(
          remoteErrorData?.message || remoteErrorData?.error || 'Outstand integration rejected the content layout'
        );
      }

      if (error instanceof BadRequestException) throw error;
      throw new InternalServerErrorException('Immediate post dispatch failed inside engine processes');
    }
  }

  async scheduleForLater(userId: string, dto: SchedulePostDto) {
    const verifiedAccounts = await this.prisma.socialAccount.findMany({
      where: {
        userId,
        platform: { in: dto.platforms.map(p => p.toUpperCase()) as SocialPlatform[] },
      },
    });

    if (!verifiedAccounts.length) {
      throw new BadRequestException('No matching social accounts found for the given platforms');
    }

    const outstandAccountIds = verifiedAccounts.map((acc) => acc.outstandAccountId);

    const results = await Promise.allSettled(
      dto.posts.map(async (postItem) => {
        const postRecord = await this.prisma.post.create({
          data: {
            userId,
            content: postItem.content,
            status: PostStatusBridge.SCHEDULED,
            scheduledAt: new Date(postItem.scheduledAt),
          },
        });

        const payload: any = {
          accounts: outstandAccountIds,
          scheduledAt: postItem.scheduledAt,
        };

        if (postItem.mediaUrls && postItem.mediaUrls.length > 0) {
          payload.containers = [{
            content: postItem.content,
            media: postItem.mediaUrls.map((url) => ({
              url,
              type: url.endsWith('.mp4') ? 'video' : 'image',
              filename: url.substring(url.lastIndexOf('/') + 1) || 'default_file',
            }))
          }];
        } else {
          payload.content = postItem.content;
        }

        try {
          console.log('Outstand Scheduling Payload:', JSON.stringify(payload));

          const response = await axios.post(`${this.outstandBaseUrl}/posts/`, payload, {
            headers: {
              'Authorization': `Bearer ${this.outstandApiKey.trim()}`,
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
          });

          const responseData = response.data;

          await this.prisma.post.update({
            where: { id: postRecord.id },
            data: { outstandPostId: responseData.post?.id },
          });

          return { success: true, postId: postRecord.id, scheduledAt: postItem.scheduledAt };

        } catch (error) {
          if (axios.isAxiosError(error)) {
            await this.prisma.post.update({
              where: { id: postRecord.id },
              data: { status: PostStatusBridge.FAILED },
            });

            const responseData = error.response?.data;
            console.error('Raw Outstand API Error Response:', responseData);

            let errorMessage = 'Outstand scheduler rejected parameters';
            if (responseData) {
              errorMessage = responseData.message ||
                             responseData.error ||
                             (typeof responseData === 'string' ? responseData : JSON.stringify(responseData));
            }

            throw new BadRequestException(errorMessage);
          }

          console.error('Scheduling Error for post:', postRecord.id, error);
          if (error instanceof BadRequestException) throw error;
          throw new InternalServerErrorException(`Scheduling failed for post: ${postRecord.id}`);
        }
      })
    );

    const succeeded = results
      .filter((r) => r.status === 'fulfilled')
      .map((r) => (r as PromiseFulfilledResult<any>).value);

    const failed = results
      .filter((r) => r.status === 'rejected')
      .map((r) => (r as PromiseRejectedResult).reason?.message || 'Unknown error');

    return {
      success: failed.length === 0,
      scheduled: succeeded,
      failed,
    };
  }

  async finalizeTwoStepConnection(userId: string, sessionToken: string) {
    try {
      const pendingResponse = await fetch(`${this.outstandBaseUrl}/social-accounts/pending/${sessionToken}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${this.outstandApiKey}` }
      });
      if (!pendingResponse.ok) throw new BadRequestException('Invalid or expired Outstand session token.');

      const resBody = await pendingResponse.json();
      const availablePages = resBody?.data?.availablePages || [];
      if (availablePages.length === 0) throw new BadRequestException('No authorized Facebook pages found.');

      const selectedPageIds = availablePages.map((page: any) => page.id);

      const finalizeResponse = await fetch(`${this.outstandBaseUrl}/social-accounts/pending/${sessionToken}/finalize`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.outstandApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ selectedPageIds }),
      });

      const finalizeData = await finalizeResponse.json().catch(() => ({}));

      if (!finalizeResponse.ok || finalizeData.success === false) {
        throw new BadRequestException('Outstand rejected the account activation payload.');
      }

      const activatedAccounts = finalizeData.connectedAccounts || [];
      const savedAccounts: any[] = [];

      await this.prisma.$transaction(async (tx) => {
        for (const acc of activatedAccounts) {
          const record = await tx.socialAccount.upsert({
            where: { outstandAccountId: acc.id },
            update: {
              status: 'active',
              username: acc.username || acc.nickname || 'Facebook Page',
              avatarUrl: null
            },
            create: {
              userId,
              outstandAccountId: acc.id,
              platform: 'FACEBOOK',
              username: acc.username || acc.nickname || 'Facebook Page',
              avatarUrl: null,
              status: 'active',
            },
          });
          savedAccounts.push(record);
        }

        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { connectedSocials: true }
        });

        if (user && !user.connectedSocials.includes('FACEBOOK' as any)) {
          await tx.user.update({
            where: { id: userId },
            data: {
              connectedSocials: {
                set: [...user.connectedSocials, 'FACEBOOK' as any]
              }
            }
          });
        }
      });

      return {
        success: true,
        message: 'Facebook integration synchronized successfully',
        accountsCount: savedAccounts.length,
        accounts: savedAccounts
      };

    } catch (error) {
      console.error('Error in Facebook structural execution:', error);
      throw error;
    }
  }

  async saveDirectConnection(userId: string, details: { outstandAccountId: string, networkUniqueId: string, username: string, platform: string }) {
    try {
      const platformEnum = details.platform.toUpperCase() as SocialPlatform;

      const result = await this.prisma.$transaction(async (tx) => {
        const accountRecord = await tx.socialAccount.upsert({
          where: { outstandAccountId: details.outstandAccountId },
          update: {
            status: 'active',
            username: details.username,
          },
          create: {
            userId: userId,
            outstandAccountId: details.outstandAccountId,
            platform: platformEnum,
            username: details.username,
            status: 'active',
          },
        });

        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { connectedSocials: true }
        });

        if (user && !user.connectedSocials.includes(platformEnum)) {
          await tx.user.update({
            where: { id: userId },
            data: {
              connectedSocials: {
                set: [...user.connectedSocials, platformEnum]
              }
            }
          });
        }

        return accountRecord;
      });

      return { success: true, message: `${details.platform} account linked successfully`, account: result };
    } catch (error) {
      console.error('Error saving direct network profile entry:', error);
      throw new InternalServerErrorException('Database sync failed during direct token assembly.');
    }
  }

  async handleIncomingWebhook(payload: any) {
    const { event, data } = payload;

    if (event === 'account.connected') {
      const localUserId = data.state;

      if (!localUserId) return { processed: false, reason: 'No tracking state located' };

      await this.prisma.socialAccount.upsert({
        where: { outstandAccountId: data.id },
        update: {
          status: 'active',
          username: data.username,
          avatarUrl: data.avatarUrl,
        },
        create: {
          userId: localUserId,
          outstandAccountId: data.id,
          platform: (data.platform as string).toUpperCase() as SocialPlatform,
          username: data.username,
          avatarUrl: data.avatarUrl,
          status: 'active',
        },
      });
      return { processed: true };
    }

    if (event === 'post.published') {
      await this.prisma.post.updateMany({
        where: { outstandPostId: data.id },
        data: { status: PostStatusBridge.PUBLISHED },
      });
      await this.prisma.postDelivery.updateMany({
        where: { outstandPostId: data.id },
        data: { deliveryStatus: DeliveryStatus.PUBLISHED },
      });
      return { processed: true };
    }

    return { processed: false, reason: 'Unhandled event signature' };
  }

  async getAllAccountsDebug() {
    try {
      const accounts = await this.prisma.socialAccount.findMany({
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              connectedSocials: true,
            },
          },
        },
      });

      return {
        success: true,
        count: accounts.length,
        data: accounts,
      };
    } catch (error) {
      console.error('Debug endpoint failed:', error);
      throw new InternalServerErrorException('Could not fetch accounts from the database.');
    }
  }
}
