import { BadRequestException, Injectable } from '@nestjs/common';
import axios from 'axios';
import { prisma } from '../../lib/prisma';

const SCOPE = 'https://www.googleapis.com/auth/business.manage';

@Injectable()
export class GoogleBusinessService {
  private readonly clientId = process.env.GOOGLE_OAUTH_CLIENT_ID ?? '';
  private readonly clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '';

  redirectUri(): string {
    if (process.env.GOOGLE_BUSINESS_REDIRECT_URI) return process.env.GOOGLE_BUSINESS_REDIRECT_URI;
    const front = process.env.FRONTEND_URL || '';
    if (front.includes('localhost')) return 'http://localhost:4000/api/google-business/callback';
    return 'https://backend.shoutlyai.com/api/google-business/callback';
  }

  authUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri(),
      response_type: 'code',
      scope: SCOPE,
      access_type: 'offline',
      prompt: 'select_account consent',
      include_granted_scopes: 'false',
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async connectFromCode(code: string, userId: string) {
    const token = await this.exchangeCode(code);
    const expiry = token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null;
    const existing = await prisma.googleBusinessAccount.findUnique({ where: { userId } });
    const account = existing
      ? await prisma.googleBusinessAccount.update({
          where: { userId },
          data: {
            accessToken: token.access_token,
            refreshToken: token.refresh_token || existing.refreshToken,
            scopes: token.scope || SCOPE,
            tokenExpiry: expiry,
          },
        })
      : await prisma.googleBusinessAccount.create({
          data: {
            userId,
            accessToken: token.access_token,
            refreshToken: token.refresh_token,
            scopes: token.scope || SCOPE,
            tokenExpiry: expiry,
          },
        });
    await this.syncLocations(account.id, token.access_token);
  }

  async status(userId: string) {
    const account = await prisma.googleBusinessAccount.findUnique({
      where: { userId },
      include: { locations: { orderBy: { title: 'asc' } } },
    });
    if (!account) {
      return { connected: false, expired: false, needsLocation: false, locations: [] };
    }
    const expired = !!account.tokenExpiry && account.tokenExpiry.getTime() <= Date.now();
    const selected = account.locations.filter((location) => location.selected && location.canPost);
    return {
      connected: selected.length > 0,
      expired,
      needsLocation: selected.length === 0,
      locations: account.locations.map((location) => ({
        id: location.id,
        title: location.title,
        selected: location.selected,
        canPost: location.canPost,
      })),
    };
  }

  async selectLocations(userId: string, ids: string[]) {
    const account = await prisma.googleBusinessAccount.findUnique({
      where: { userId },
      include: { locations: true },
    });
    if (!account) throw new BadRequestException('Connect Google Business first.');
    const known = new Set(account.locations.map((location) => location.id));
    if (ids.some((id) => !known.has(id))) {
      throw new BadRequestException('That location is not on this account.');
    }
    const chosen = new Set(ids);
    for (const location of account.locations) {
      if (chosen.has(location.id) && !location.canPost) {
        throw new BadRequestException(`${location.title} cannot take posts yet.`);
      }
    }
    if (account.locations.length) {
      await prisma.$transaction(
        account.locations.map((location) =>
          prisma.googleBusinessLocation.update({
            where: { id: location.id },
            data: { selected: chosen.has(location.id) },
          }),
        ),
      );
    }
    if (chosen.size > 0) await this.markConnected(userId);
    else await this.unmarkConnected(userId);
    return this.status(userId);
  }

  async disconnect(userId: string) {
    await prisma.googleBusinessAccount.deleteMany({ where: { userId } });
    await this.unmarkConnected(userId);
    return { success: true };
  }

  async publishForUser(userId: string, summary: string, mediaUrl?: string) {
    const text = summary?.trim();
    if (!text) throw new BadRequestException('Write a caption before posting to Google Business.');
    const account = await prisma.googleBusinessAccount.findUnique({
      where: { userId },
      include: { locations: { where: { selected: true, canPost: true } } },
    });
    if (!account?.locations.length) {
      throw new BadRequestException('Choose a Google Business location before posting.');
    }
    const token = await this.freshToken(account);
    const image = mediaUrl && !this.isVideo(mediaUrl) ? mediaUrl : undefined;
    for (const location of account.locations) {
      const response = await axios.post(
        `https://mybusiness.googleapis.com/v4/${location.accountResourceName}/${location.locationResourceName}/localPosts`,
        {
          languageCode: 'en',
          summary: text.slice(0, 1500),
          topicType: 'STANDARD',
          ...(image ? { media: [{ mediaFormat: 'PHOTO', sourceUrl: image }] } : {}),
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'X-GOOG-API-FORMAT-VERSION': '2',
          },
          validateStatus: () => true,
        },
      );
      if (response.status >= 400) {
        throw new BadRequestException(this.googleMessage(response.data, 'Google Business rejected the post.'));
      }
    }
  }

  private async syncLocations(accountId: string, accessToken: string) {
    const previous = await prisma.googleBusinessLocation.findMany({ where: { googleBusinessAccountId: accountId } });
    const selected = new Set(previous.filter((location) => location.selected).map((location) => location.locationResourceName));
    const accounts = await this.listPages<{ name?: string; accountName?: string }>(
      'https://mybusinessaccountmanagement.googleapis.com/v1/accounts',
      accessToken,
      'accounts',
    );
    const next: { accountResourceName: string; locationResourceName: string; title: string; canPost: boolean; selected: boolean }[] = [];
    for (const item of accounts) {
      if (!item.name) continue;
      const locations = await this.listPages<{ name?: string; title?: string; metadata?: { canOperateLocalPost?: boolean } }>(
        `https://mybusinessbusinessinformation.googleapis.com/v1/${item.name}/locations`,
        accessToken,
        'locations',
        { readMask: 'name,title,metadata', pageSize: 100 },
      );
      if (!locations.length) {
        next.push({
          accountResourceName: item.name,
          locationResourceName: item.name,
          title: item.accountName || 'Business account',
          canPost: false,
          selected: false,
        });
      }
      for (const location of locations) {
        if (!location.name) continue;
        const canPost = !!location.metadata?.canOperateLocalPost;
        next.push({
          accountResourceName: item.name,
          locationResourceName: location.name,
          title: location.title || 'Untitled location',
          canPost,
          selected: canPost && selected.has(location.name),
        });
      }
    }
    await prisma.googleBusinessLocation.deleteMany({ where: { googleBusinessAccountId: accountId } });
    if (next.length) {
      await prisma.googleBusinessLocation.createMany({
        data: next.map((location) => ({ googleBusinessAccountId: accountId, ...location })),
      });
    }
    const userId = (await prisma.googleBusinessAccount.findUnique({ where: { id: accountId }, select: { userId: true } }))?.userId;
    if (!userId) return;
    if (next.some((location) => location.selected)) await this.markConnected(userId);
    else await this.unmarkConnected(userId);
  }

  private async listPages<T>(url: string, accessToken: string, key: string, extra?: Record<string, string | number>) {
    const rows: T[] = [];
    let pageToken: string | undefined;
    do {
      const response = await axios.get(url, {
        headers: { Authorization: `Bearer ${accessToken}`, 'X-GOOG-API-FORMAT-VERSION': '2' },
        params: { pageSize: 100, ...extra, pageToken },
        validateStatus: () => true,
      });
      if (response.status >= 400) {
        throw new BadRequestException(this.googleMessage(response.data, 'Could not read Google Business locations.'));
      }
      rows.push(...((response.data?.[key] as T[]) || []));
      pageToken = response.data?.nextPageToken;
    } while (pageToken);
    return rows;
  }

  private async exchangeCode(code: string) {
    const body = new URLSearchParams({
      code,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: this.redirectUri(),
      grant_type: 'authorization_code',
    });
    const response = await axios.post('https://oauth2.googleapis.com/token', body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      validateStatus: () => true,
    });
    if (response.status >= 400 || !response.data?.access_token) {
      throw new BadRequestException(this.googleMessage(response.data, 'Google Business connection failed.'));
    }
    return response.data as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };
  }

  private async freshToken(account: { id: string; accessToken: string; refreshToken: string | null; tokenExpiry: Date | null }) {
    if (!account.tokenExpiry || account.tokenExpiry.getTime() > Date.now() + 60_000) return account.accessToken;
    if (!account.refreshToken) throw new BadRequestException('Connect Google Business again.');
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: account.refreshToken,
      grant_type: 'refresh_token',
    });
    const response = await axios.post('https://oauth2.googleapis.com/token', body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      validateStatus: () => true,
    });
    if (response.status >= 400 || !response.data?.access_token) {
      throw new BadRequestException('Connect Google Business again.');
    }
    const expiry = response.data.expires_in ? new Date(Date.now() + response.data.expires_in * 1000) : null;
    await prisma.googleBusinessAccount.update({
      where: { id: account.id },
      data: { accessToken: response.data.access_token, tokenExpiry: expiry },
    });
    return response.data.access_token as string;
  }

  private async markConnected(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { connectedSocials: true } });
    if (!user || user.connectedSocials.includes('GOOGLE_BUSINESS')) return;
    await prisma.user.update({
      where: { id: userId },
      data: { connectedSocials: { set: [...user.connectedSocials, 'GOOGLE_BUSINESS'] } },
    });
  }

  private async unmarkConnected(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { connectedSocials: true } });
    if (!user?.connectedSocials.includes('GOOGLE_BUSINESS')) return;
    await prisma.user.update({
      where: { id: userId },
      data: { connectedSocials: { set: user.connectedSocials.filter((platform) => platform !== 'GOOGLE_BUSINESS') } },
    });
  }

  private isVideo(url: string) {
    const path = url.split('?')[0].toLowerCase();
    return path.endsWith('.mp4') || path.endsWith('.mov') || path.endsWith('.webm');
  }

  private googleMessage(data: unknown, fallback: string): string {
    if (data && typeof data === 'object' && 'error' in data) {
      const error = (data as { error?: { message?: string } | string }).error;
      if (typeof error === 'string') return error;
      if (error?.message) return error.message;
    }
    return fallback;
  }
}
