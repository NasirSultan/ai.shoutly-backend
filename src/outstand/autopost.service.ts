import { Injectable, NotFoundException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ConnectAccountDto } from './dto/connect-account.dto';
import { PublishPostDto } from './dto/publish-post.dto';
import { SchedulePostDto } from './dto/schedule-post.dto';
import { Platform } from '@prisma/client';
import axios from 'axios';

@Injectable()
export class AutopostService {
  private prisma = new PrismaClient();
  private readonly outstandApiKey = "ost_DFRKRnqHLgDCZGDqYCXywbmkFQOnqNtBHhpyGpnkqFsIFkdCSycGcbkTOECKlnta";
  private readonly outstandBaseUrl = 'https://api.outstand.so/v1';
  // ✅ Add this private helper at the top of AutopostService class
  private normalizePlatform(raw: string | null | undefined): 'FACEBOOK' | 'INSTAGRAM' | 'LINKEDIN' | 'X' {
    const map: Record<string, 'FACEBOOK' | 'INSTAGRAM' | 'LINKEDIN' | 'X'> = {
      facebook: 'FACEBOOK',
      instagram: 'INSTAGRAM',
      linkedin: 'LINKEDIN',
      x: 'X',
      twitter: 'X',
    }
    const normalized = map[raw?.toLowerCase()?.trim() ?? '']
    if (!normalized) {
      console.warn(`[Platform] Unknown platform value received: "${raw}", defaulting to FACEBOOK`)
      return 'FACEBOOK'
    }
    return normalized
  }
  
  constructor() {
    if (!this.outstandApiKey) {
      console.warn('Warning: OUTSTAND_API_KEY is not defined in your environment variables.');
    }
  }

  async getConnectUrl(userId: string, dto: ConnectAccountDto) {
    try {
      console.log('Outstand Config:', { url: this.outstandBaseUrl, hasKey: !!this.outstandApiKey, platform: dto.platform });

      // 1. Correct endpoint formatting: /v1/social-networks/:network/auth-url
      // 2. Change method from GET to POST
      const response = await fetch(`${this.outstandBaseUrl}/social-networks/${dto.platform}/auth-url`, {
        method: 'POST', 
        headers: {
          'Authorization': `Bearer ${this.outstandApiKey}`,
          'Content-Type': 'application/json',
        },
        // 3. You MUST provide the redirect_uri in the body payload
        body: JSON.stringify({
          redirect_uri: 'https://shoutlyai.com/dashboards?status=connecting', // Replace with your real app callback
          state: userId // You can safely pass your state/userId here inside the body object
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('Exact Outstand API Error Response:', errorData);
        throw new BadRequestException(errorData.message || 'Failed to fetch authorization URL from Outstand');
      }
      const resData = await response.json();
      console.log('Outstand Success Payload:', resData); // <--- Add this
      return { redirectUrl: resData.data.auth_url };
      
    } catch (error) {
      console.error('Outstand connection error:', error);
      if (error instanceof BadRequestException) throw error;
      throw new InternalServerErrorException('Error contacting Outstand service layer');
    }
  }

  async getUserAccounts(userId: string) {
    // ✅ Raw query bypasses Prisma enum validation entirely
    const accounts = await this.prisma.$queryRaw`
      SELECT id, "outstandAccountId", platform, username, status, "createdAt"
      FROM "SocialAccount"
      WHERE "userId" = ${userId}
      ORDER BY "createdAt" DESC
    `

    return {
      success: true,
      count: (accounts as any[]).length,
      data: accounts,
    }
  }

  async fixAccountPlatforms() {
    // Fix luxespace_digital → INSTAGRAM
    const instagram = await this.prisma.$executeRaw`
      UPDATE "SocialAccount" 
      SET platform = 'INSTAGRAM' 
      WHERE id = '22613d25-7efe-4a03-8fd6-ca7789ce06f2'
    `

    // Fix Infyze AI Solutions → FACEBOOK
    const facebook = await this.prisma.$executeRaw`
      UPDATE "SocialAccount" 
      SET platform = 'FACEBOOK' 
      WHERE id = '1c5ae21a-15c1-41a2-aa22-43674ead7cd9'
    `

    return {
      success: true,
      message: 'Platforms updated',
      updated: { instagram, facebook }
    }
  }

  async publishImmediately(userId: string, dto: PublishPostDto) {
    // 1. Resolve outstandAccountIds from platforms via DB
    const verifiedAccounts = await this.prisma.socialAccount.findMany({
      where: {
        userId,
        platform: { in: dto.platforms as Platform[] },
      },
    });

    if (!verifiedAccounts.length) {
      throw new BadRequestException('No matching social accounts found for the given platforms');
    }

    const outstandAccountIds = verifiedAccounts.map((acc) => acc.outstandAccountId);

    // 2. Create post record
    const postRecord = await this.prisma.post.create({
      data: {
        userId,
        content: dto.content,
        status: 'PROCESSING',
      },
    });

    // 3. Build container
    const container: any = { content: dto.content };

    if (dto.mediaUrls && dto.mediaUrls.length > 0) {
      container.media = dto.mediaUrls.map((url) => ({
        url,
        type: url.endsWith('.mp4') ? 'video' : 'image',
        filename: url.substring(url.lastIndexOf('/') + 1) || 'default_file',
      }));
    }

    // 4. Fire to Outstand
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
          status: 'PUBLISHED',
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
          data: { status: 'FAILED' },
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
    // 1. Resolve outstandAccountIds from platforms via DB
    
    const verifiedAccounts = await this.prisma.socialAccount.findMany({
      where: {
        userId,
        platform: { in: dto.platforms as Platform[] },
      },
    });
    
    if (!verifiedAccounts.length) {
      throw new BadRequestException('No matching social accounts found for the given platforms');
    }

    const outstandAccountIds = verifiedAccounts.map((acc) => acc.outstandAccountId);

    // 2. Process each post independently
    const results = await Promise.allSettled(
      dto.posts.map(async (postItem) => {
        // Create individual post record
        const postRecord = await this.prisma.post.create({
          data: {
            userId,
            content: postItem.content,
            status: 'SCHEDULED',
            scheduledAt: new Date(postItem.scheduledAt),
          },
        });

        // Build Payload Dynamic Shape
        const payload: any = {
          accounts: outstandAccountIds,
          scheduledAt: postItem.scheduledAt,
        };

        // If there is media, use the strict container array model
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
          // For simple single text posts, use top-level content as recommended by docs
          payload.content = postItem.content;
        }

        // Fire to Outstand
        try {
          console.log('Outstand Scheduling Payload:', JSON.stringify(payload));
          console.log('Outstand API Key:', this.outstandApiKey);
          console.log('Outstand Base URL:', this.outstandBaseUrl);

          const targetUrl = `${this.outstandBaseUrl}/posts/`;
          console.log('Target URL:', targetUrl);

          const response = await axios.post(targetUrl, payload, {
            headers: {
              'Authorization': `Bearer ${this.outstandApiKey.trim()}`,
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
          });

          // Axios automatically parses JSON data into response.data
          const responseData = response.data;

          await this.prisma.post.update({
            where: { id: postRecord.id },
            data: { outstandPostId: responseData.post?.id },
          });

          return { success: true, postId: postRecord.id, scheduledAt: postItem.scheduledAt };

        } catch (error) {
          console.error('Outstand Scheduling Error:', error.response.data);
          if (axios.isAxiosError(error)) {
            await this.prisma.post.update({
              where: { id: postRecord.id },
              data: { status: 'FAILED' },
            });

            const responseData = error.response?.data;
            console.error('Raw Outstand API Error Response:', responseData);

            // Dynamic error fallback parsing
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

    // 3. Aggregate results
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
  
  // 🅰️ Logic for Facebook's intermediate validation step
  async finalizeTwoStepConnection(userId: string, sessionToken: string) {
    try {
      // 1. Fetch pending pages from Outstand
      const pendingResponse = await fetch(`${this.outstandBaseUrl}/social-accounts/pending/${sessionToken}`, { 
        method: 'GET',
        headers: { 'Authorization': `Bearer ${this.outstandApiKey}` }
      });
      if (!pendingResponse.ok) throw new BadRequestException('Invalid or expired Outstand session token.');

      const resBody = await pendingResponse.json();
      const availablePages = resBody?.data?.availablePages || [];
      if (availablePages.length === 0) throw new BadRequestException('No authorized Facebook pages found.');

      const selectedPageIds = availablePages.map((page: any) => page.id);

      // 2. Finalize with Outstand
      // Inside your autopost.service.ts -> finalizeTwoStepConnection method:

      // 2. Finalize with Outstand
    // 2. Finalize with Outstand
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

    // 🎯 TARGETED INTERCEPTION: Directly grab the connectedAccounts array from Outstand's layout
    const activatedAccounts = finalizeData.connectedAccounts || []; 
    const savedAccounts: any[] = []; 

      // ✅ Raw SQL upsert — bypasses Platform vs SocialPlatform enum mismatch
      for (const acc of activatedAccounts) {
        const username = acc.username || acc.nickname || 'Facebook Page'

        await this.prisma.$executeRaw`
          DELETE FROM "SocialAccount"
          WHERE "userId" = ${userId}
          AND platform = 'FACEBOOK'::"SocialPlatform"
        `

        await this.prisma.$executeRaw`
          INSERT INTO "SocialAccount" (id, "userId", "outstandAccountId", platform, username, "avatarUrl", status, "createdAt", "updatedAt")
          VALUES (
            gen_random_uuid(),
            ${userId},
            ${acc.id},
            'FACEBOOK'::"SocialPlatform",
            ${username},
            NULL,
            'active',
            NOW(),
            NOW()
          )
          ON CONFLICT ("outstandAccountId")
          DO UPDATE SET
            platform   = 'FACEBOOK'::"SocialPlatform",
            username   = ${username},
            "avatarUrl" = NULL,
            status     = 'active',
            "updatedAt" = NOW()
        `

        const saved = await this.prisma.$queryRaw<any[]>`
          SELECT * FROM "SocialAccount" WHERE "outstandAccountId" = ${acc.id}
        `
        savedAccounts.push(saved[0])
      }

      // Update connectedSocials on user
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { connectedSocials: true }
      })

      if (user && !user.connectedSocials.includes('FACEBOOK' as any)) {
        await this.prisma.user.update({
          where: { id: userId },
          data: {
            connectedSocials: {
              set: [...user.connectedSocials, 'FACEBOOK' as any]
            }
          }
        })
      }

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
  

  async saveDirectConnection(userId: string, details: {
    outstandAccountId: string,
    networkUniqueId: string,
    username: string,
    platform: string
  }) {
    try {
      const platformEnum = this.normalizePlatform(details.platform)

      await this.prisma.$executeRaw`
        DELETE FROM "SocialAccount"
        WHERE "userId" = ${userId}
        AND platform = ${platformEnum}::"SocialPlatform"
      `
      
      // ✅ Raw upsert bypasses Prisma enum type mismatch (Platform vs SocialPlatform)
      await this.prisma.$executeRaw`
        INSERT INTO "SocialAccount" (id, "userId", "outstandAccountId", platform, username, status, "createdAt", "updatedAt")
        VALUES (
          gen_random_uuid(),
          ${userId},
          ${details.outstandAccountId},
          ${platformEnum}::"SocialPlatform",
          ${details.username},
          'active',
          NOW(),
          NOW()
        )
        ON CONFLICT ("outstandAccountId")
        DO UPDATE SET
          platform = ${platformEnum}::"SocialPlatform",
          username = ${details.username},
          status = 'active',
          "updatedAt" = NOW()
      `

      // Fetch the saved record to return it
      const accountRecord = await this.prisma.$queryRaw<any[]>`
        SELECT * FROM "SocialAccount" WHERE "outstandAccountId" = ${details.outstandAccountId}
      `

      // Update connectedSocials on user
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { connectedSocials: true }
      })

      if (user && !user.connectedSocials.includes(platformEnum as any)) {
        await this.prisma.user.update({
          where: { id: userId },
          data: {
            connectedSocials: {
              set: [...user.connectedSocials, platformEnum as any]
            }
          }
        })
      }

      return {
        success: true,
        message: `${platformEnum} account linked successfully`,
        account: accountRecord[0]
      }

    } catch (error) {
      console.error('Error saving direct network profile entry:', error)
      throw new InternalServerErrorException('Database sync failed during direct token assembly.')
    }
  }  
  
  // Webhook intake to log finalized connections coming over the wire asynchronously
  async handleIncomingWebhook(payload: any) {
    const { event, data } = payload;

    if (event === 'account.connected') {
      const localUserId = data.state; // Recovering original tracking string passed inside state parameter

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
          platform: data.platform,
          username: data.username,
          avatarUrl: data.avatarUrl,
          status: 'active',
        },
      });
      return { processed: true };
    }

    // Dynamic state updates whenever scheduled posts are completed on target networks
    if (event === 'post.published') {
      await this.prisma.post.updateMany({
        where: { outstandPostId: data.id },
        data: { status: 'PUBLISHED' },
      });
      await this.prisma.postDelivery.updateMany({
        where: { outstandPostId: data.id },
        data: { deliveryStatus: 'PUBLISHED' },
      });
      return { processed: true };
    }

    return { processed: false, reason: 'Unhandled event signature' };
  }

  // 🔬 TEMPORARY TESTING ENDPOINT LOGIC
  async getAllAccountsDebug() {
    try {
      const accounts = await this.prisma.socialAccount.findMany({
        orderBy: {
          createdAt: 'desc', // Show the newest connections at the top
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              connectedSocials: true, // Verification check: See if this array updated on the user!
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