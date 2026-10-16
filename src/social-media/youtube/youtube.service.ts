import { BadRequestException, Injectable } from '@nestjs/common';
import axios from 'axios';
import { prisma } from '../../lib/prisma';

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
].join(' ');

type YoutubeOptions = {
  title?: string;
  privacyStatus?: 'public' | 'private' | 'unlisted';
  tags?: string[];
  madeForKids?: boolean;
  isShort?: boolean;
};

@Injectable()
export class YoutubeService {
  private readonly clientId = process.env.GOOGLE_OAUTH_CLIENT_ID ?? '';
  private readonly clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '';

  redirectUri(): string {
    if (process.env.YOUTUBE_REDIRECT_URI) return process.env.YOUTUBE_REDIRECT_URI;
    const front = process.env.FRONTEND_URL || '';
    if (front.includes('localhost')) return 'http://localhost:4000/api/youtube/callback';
    return 'https://backend.shoutlyai.com/api/youtube/callback';
  }

  authUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri(),
      response_type: 'code',
      scope: SCOPES,
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'false',
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async connectFromCode(code: string, userId: string) {
    const token = await this.exchangeCode(code);
    const channel = await this.fetchChannel(token.access_token);
    const expiry = token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null;
    const data = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      scopes: token.scope || SCOPES,
      tokenExpiry: expiry,
      channelId: channel?.id ?? null,
      channelTitle: channel?.snippet?.title ?? null,
      thumbnailUrl: channel?.snippet?.thumbnails?.default?.url ?? null,
      subscriberCount: channel?.statistics?.subscriberCount ?? null,
      viewCount: channel?.statistics?.viewCount ?? null,
      videoCount: channel?.statistics?.videoCount ?? null,
    };
    const existing = await prisma.youtubeAccount.findUnique({ where: { userId } });
    if (existing) {
      await prisma.youtubeAccount.update({
        where: { userId },
        data: {
          ...data,
          refreshToken: token.refresh_token || existing.refreshToken,
        },
      });
    } else {
      await prisma.youtubeAccount.create({ data: { userId, ...data } });
    }
    await this.markConnected(userId);
  }

  async status(userId: string) {
    const account = await prisma.youtubeAccount.findUnique({ where: { userId } });
    if (!account) {
      return { connected: false, expired: false, name: null, picture: null, subscribers: null, views: null, videos: null };
    }
    const expired = !!account.tokenExpiry && account.tokenExpiry.getTime() <= Date.now();
    if (!expired) {
      try {
        const token = await this.freshToken(account);
        const channel = await this.fetchChannel(token);
        if (channel) {
          await prisma.youtubeAccount.update({
            where: { userId },
            data: {
              channelId: channel.id,
              channelTitle: channel.snippet?.title ?? account.channelTitle,
              thumbnailUrl: channel.snippet?.thumbnails?.default?.url ?? account.thumbnailUrl,
              subscriberCount: channel.statistics?.subscriberCount ?? account.subscriberCount,
              viewCount: channel.statistics?.viewCount ?? account.viewCount,
              videoCount: channel.statistics?.videoCount ?? account.videoCount,
            },
          });
          return {
            connected: true,
            expired: false,
            name: channel.snippet?.title ?? account.channelTitle,
            picture: channel.snippet?.thumbnails?.default?.url ?? account.thumbnailUrl,
            subscribers: channel.statistics?.subscriberCount ?? account.subscriberCount,
            views: channel.statistics?.viewCount ?? account.viewCount,
            videos: channel.statistics?.videoCount ?? account.videoCount,
          };
        }
      } catch {
        // Keep the last saved channel stats if Google is briefly unavailable.
      }
    }
    return {
      connected: true,
      expired,
      name: account.channelTitle,
      picture: account.thumbnailUrl,
      subscribers: account.subscriberCount,
      views: account.viewCount,
      videos: account.videoCount,
    };
  }

  async disconnect(userId: string) {
    await prisma.youtubeAccount.deleteMany({ where: { userId } });
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { connectedSocials: true } });
    if (user?.connectedSocials.includes('YOUTUBE')) {
      await prisma.user.update({
        where: { id: userId },
        data: { connectedSocials: { set: user.connectedSocials.filter((platform) => platform !== 'YOUTUBE') } },
      });
    }
    return { success: true };
  }

  async publishForUser(userId: string, description: string, mediaUrl: string | undefined, options?: YoutubeOptions) {
    if (!mediaUrl) {
      throw new BadRequestException('YouTube requires a video file.');
    }
    const account = await prisma.youtubeAccount.findUnique({ where: { userId } });
    if (!account) {
      throw new BadRequestException('Connect your YouTube channel before posting to YouTube.');
    }
    const token = await this.freshToken(account);
    const video = await axios.get<ArrayBuffer>(mediaUrl, {
      responseType: 'arraybuffer',
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
    const contentType = String(video.headers['content-type'] || 'video/mp4').split(';')[0];
    let text = description || '';
    if (options?.isShort && !text.includes('#Shorts')) text = `${text}\n#Shorts`.trim();
    const title = (options?.title || text.split('\n')[0] || 'Video').slice(0, 100);
    const init = await axios.post(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
      {
        snippet: {
          title,
          description: text.slice(0, 5000),
          ...(options?.tags?.length ? { tags: options.tags } : {}),
        },
        status: {
          privacyStatus: options?.privacyStatus || 'public',
          selfDeclaredMadeForKids: !!options?.madeForKids,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': contentType,
        },
        maxRedirects: 0,
        validateStatus: (status) => status >= 200 && status < 400,
      },
    );
    const uploadUrl = init.headers.location as string | undefined;
    if (!uploadUrl) {
      throw new BadRequestException(this.googleMessage(init.data, 'YouTube did not accept the video.'));
    }
    const uploaded = await axios.put(uploadUrl, Buffer.from(video.data), {
      headers: { 'Content-Type': contentType },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      validateStatus: (status) => status >= 200 && status < 300,
    });
    if (uploaded.status >= 300) {
      throw new BadRequestException(this.googleMessage(uploaded.data, 'YouTube rejected the video.'));
    }
    return uploaded.data;
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
      throw new BadRequestException(this.googleMessage(response.data, 'YouTube connection failed.'));
    }
    return response.data as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };
  }

  private async freshToken(account: { userId: string; accessToken: string; refreshToken: string | null; tokenExpiry: Date | null }) {
    if (!account.tokenExpiry || account.tokenExpiry.getTime() > Date.now() + 60_000) return account.accessToken;
    if (!account.refreshToken) {
      throw new BadRequestException('Connect your YouTube channel again.');
    }
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
      throw new BadRequestException('Connect your YouTube channel again.');
    }
    const expiry = response.data.expires_in ? new Date(Date.now() + response.data.expires_in * 1000) : null;
    await prisma.youtubeAccount.update({
      where: { userId: account.userId },
      data: { accessToken: response.data.access_token, tokenExpiry: expiry },
    });
    return response.data.access_token as string;
  }

  private async fetchChannel(accessToken: string) {
    const response = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
      params: { part: 'snippet,statistics', mine: true },
      headers: { Authorization: `Bearer ${accessToken}` },
      validateStatus: () => true,
    });
    if (response.status >= 400) return null;
    return response.data?.items?.[0] as {
      id: string;
      snippet?: { title?: string; thumbnails?: { default?: { url?: string } } };
      statistics?: { subscriberCount?: string; viewCount?: string; videoCount?: string };
    } | undefined;
  }

  private async markConnected(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { connectedSocials: true } });
    if (!user || user.connectedSocials.includes('YOUTUBE')) return;
    await prisma.user.update({
      where: { id: userId },
      data: { connectedSocials: { set: [...user.connectedSocials, 'YOUTUBE'] } },
    });
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
