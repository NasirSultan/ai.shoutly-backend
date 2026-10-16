import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import axios from 'axios';
import { prisma } from '../../lib/prisma';
import { RedisService } from '../../common/redis/redis.service';

const SCOPES = 'tweet.read tweet.write users.read media.write offline.access';

@Injectable()
export class XService {
  private readonly clientId = process.env.X_CLIENT_ID ?? '';
  private readonly clientSecret = process.env.X_CLIENT_SECRET ?? '';

  constructor(private readonly redisService: RedisService) {}

  redirectUri(): string {
    if (process.env.X_REDIRECT_URI) return process.env.X_REDIRECT_URI;
    const front = process.env.FRONTEND_URL || '';
    if (front.includes('localhost')) return 'http://localhost:4000/api/x/callback';
    return 'https://backend.shoutlyai.com/api/x/callback';
  }

  async authUrl(userId: string, shoutlyToken: string): Promise<string> {
    if (!this.clientId || !this.clientSecret) {
      throw new BadRequestException('X app credentials are missing on the server.');
    }
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const state = randomBytes(16).toString('base64url');
    await this.redisService.getClient().set(
      `x:oauth:${state}`,
      JSON.stringify({ userId, token: shoutlyToken, verifier }),
      { EX: 600 },
    );
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: this.redirectUri(),
      scope: SCOPES,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    return `https://x.com/i/oauth2/authorize?${params.toString()}`;
  }

  async takePending(state: string): Promise<{ userId: string; token: string; verifier: string } | null> {
    const key = `x:oauth:${state}`;
    const raw = await this.redisService.getClient().get(key);
    if (!raw) return null;
    await this.redisService.getClient().del(key);
    const parsed = JSON.parse(raw) as { userId?: string; token?: string; verifier?: string };
    if (!parsed.userId || !parsed.token || !parsed.verifier) return null;
    return { userId: parsed.userId, token: parsed.token, verifier: parsed.verifier };
  }

  async connectFromCode(code: string, userId: string, verifier: string) {
    const token = await this.exchangeCode(code, verifier);
    const profile = await this.fetchMe(token.access_token);
    const expiry = token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null;
    const data = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      scopes: token.scope || SCOPES,
      tokenExpiry: expiry,
      xUserId: profile?.id ?? null,
      username: profile?.username ?? null,
      name: profile?.name ?? null,
      profileImageUrl: profile?.profile_image_url ?? null,
      followersCount: profile?.public_metrics?.followers_count != null ? String(profile.public_metrics.followers_count) : null,
      followingCount: profile?.public_metrics?.following_count != null ? String(profile.public_metrics.following_count) : null,
      tweetCount: profile?.public_metrics?.tweet_count != null ? String(profile.public_metrics.tweet_count) : null,
    };
    const existing = await prisma.xAccount.findUnique({ where: { userId } });
    if (existing) {
      await prisma.xAccount.update({
        where: { userId },
        data: { ...data, refreshToken: token.refresh_token || existing.refreshToken },
      });
    } else {
      await prisma.xAccount.create({ data: { userId, ...data } });
    }
    await this.markConnected(userId);
  }

  async status(userId: string) {
    const account = await prisma.xAccount.findUnique({ where: { userId } });
    if (!account) {
      return { connected: false, expired: false, name: null, username: null, picture: null, followers: null };
    }
    try {
      const token = await this.freshToken(account);
      const profile = await this.fetchMe(token);
      if (profile) {
        await prisma.xAccount.update({
          where: { userId },
          data: {
            xUserId: profile.id,
            username: profile.username ?? account.username,
            name: profile.name ?? account.name,
            profileImageUrl: profile.profile_image_url ?? account.profileImageUrl,
            followersCount: profile.public_metrics?.followers_count != null ? String(profile.public_metrics.followers_count) : account.followersCount,
            followingCount: profile.public_metrics?.following_count != null ? String(profile.public_metrics.following_count) : account.followingCount,
            tweetCount: profile.public_metrics?.tweet_count != null ? String(profile.public_metrics.tweet_count) : account.tweetCount,
          },
        });
      }
      return {
        connected: true,
        expired: false,
        name: profile?.name ?? account.name,
        username: profile?.username ?? account.username,
        picture: profile?.profile_image_url ?? account.profileImageUrl,
        followers: profile?.public_metrics?.followers_count != null ? String(profile.public_metrics.followers_count) : account.followersCount,
      };
    } catch {
      return {
        connected: true,
        expired: true,
        name: account.name,
        username: account.username,
        picture: account.profileImageUrl,
        followers: account.followersCount,
      };
    }
  }

  async disconnect(userId: string) {
    const account = await prisma.xAccount.findUnique({ where: { userId } });
    if (account) {
      const token = account.refreshToken || account.accessToken;
      const hint = account.refreshToken ? 'refresh_token' : 'access_token';
      try {
        await this.revoke(token, hint);
      } catch {
        // Local disconnect still proceeds if X already revoked the token.
      }
    }
    await prisma.xAccount.deleteMany({ where: { userId } });
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { connectedSocials: true } });
    if (user?.connectedSocials.includes('X')) {
      await prisma.user.update({
        where: { id: userId },
        data: { connectedSocials: { set: user.connectedSocials.filter((platform) => platform !== 'X') } },
      });
    }
    return { success: true };
  }

  async publishForUser(userId: string, text: string, mediaUrls?: string[]) {
    const account = await prisma.xAccount.findUnique({ where: { userId } });
    if (!account) throw new BadRequestException('Connect X before posting to X.');
    const caption = (text || '').trim();
    const urls = (mediaUrls || []).map((url) => url.trim()).filter(Boolean);
    if (!caption && !urls.length) throw new BadRequestException('Write a caption or attach media before posting to X.');
    const token = await this.freshToken(account);
    const mediaIds: string[] = [];
    const video = urls.find((url) => this.looksLikeVideo(url));
    const chosen = video ? [video] : urls.slice(0, 4);
    for (const url of chosen) {
      mediaIds.push(await this.uploadMedia(token, url));
    }
    const body: { text?: string; media?: { media_ids: string[] } } = {};
    if (caption) body.text = caption;
    if (mediaIds.length) body.media = { media_ids: mediaIds };
    const response = await axios.post('https://api.x.com/2/tweets', body, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      validateStatus: () => true,
    });
    if (response.status >= 400 || !response.data?.data?.id) {
      throw new BadRequestException(this.xMessage(response.data, 'X rejected the post.'));
    }
    return response.data.data as { id: string; text?: string };
  }

  private looksLikeVideo(url: string) {
    const path = url.split('?')[0].toLowerCase();
    return path.endsWith('.mp4') || path.endsWith('.mov') || path.endsWith('.webm');
  }

  private async uploadMedia(token: string, url: string) {
    const file = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
    const bytes = Buffer.from(file.data);
    const contentType = String(file.headers['content-type'] || this.typeFromUrl(url)).split(';')[0];
    const mediaCategory = contentType === 'image/gif' ? 'tweet_gif' : contentType.startsWith('video/') ? 'tweet_video' : 'tweet_image';
    const init = await axios.post(
      'https://api.x.com/2/media/upload/initialize',
      { media_type: contentType, total_bytes: bytes.length, media_category: mediaCategory },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, validateStatus: () => true },
    );
    const mediaId = init.data?.data?.id as string | undefined;
    if (init.status >= 400 || !mediaId) {
      throw new BadRequestException(this.xMessage(init.data, 'X did not accept the media.'));
    }
    const chunkSize = 4 * 1024 * 1024;
    let segment = 0;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const chunk = bytes.subarray(offset, offset + chunkSize);
      const form = new FormData();
      form.append('segment_index', String(segment));
      form.append('media', new Blob([chunk], { type: contentType }), 'upload');
      const appended = await axios.post(`https://api.x.com/2/media/upload/${mediaId}/append`, form, {
        headers: { Authorization: `Bearer ${token}` },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        validateStatus: () => true,
      });
      if (appended.status >= 400) {
        throw new BadRequestException(this.xMessage(appended.data, 'X did not accept the media.'));
      }
      segment += 1;
    }
    const finalized = await axios.post(
      `https://api.x.com/2/media/upload/${mediaId}/finalize`,
      {},
      { headers: { Authorization: `Bearer ${token}` }, validateStatus: () => true },
    );
    if (finalized.status >= 400) {
      throw new BadRequestException(this.xMessage(finalized.data, 'X did not accept the media.'));
    }
    let processing = finalized.data?.data?.processing_info as { state?: string; check_after_secs?: number; error?: { message?: string } } | undefined;
    for (let attempt = 0; processing && processing.state !== 'succeeded' && attempt < 30; attempt += 1) {
      if (processing.state === 'failed') {
        throw new BadRequestException(processing.error?.message || 'X could not process the media.');
      }
      const wait = Math.min(processing.check_after_secs || 2, 10);
      await new Promise((resolve) => setTimeout(resolve, wait * 1000));
      const status = await axios.get('https://api.x.com/2/media/upload', {
        params: { command: 'STATUS', media_id: mediaId },
        headers: { Authorization: `Bearer ${token}` },
        validateStatus: () => true,
      });
      if (status.status >= 400) {
        throw new BadRequestException(this.xMessage(status.data, 'X could not process the media.'));
      }
      processing = status.data?.data?.processing_info;
    }
    if (processing && processing.state !== 'succeeded') {
      throw new BadRequestException('X is still processing the media. Try again in a moment.');
    }
    return mediaId;
  }

  private typeFromUrl(url: string) {
    const path = url.split('?')[0].toLowerCase();
    if (path.endsWith('.png')) return 'image/png';
    if (path.endsWith('.gif')) return 'image/gif';
    if (path.endsWith('.webp')) return 'image/webp';
    if (path.endsWith('.mp4')) return 'video/mp4';
    if (path.endsWith('.mov')) return 'video/quicktime';
    if (path.endsWith('.webm')) return 'video/webm';
    return 'image/jpeg';
  }

  private async exchangeCode(code: string, verifier: string) {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri(),
      code_verifier: verifier,
    });
    const response = await axios.post('https://api.x.com/2/oauth2/token', body.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`,
      },
      validateStatus: () => true,
    });
    if (response.status >= 400 || !response.data?.access_token) {
      throw new BadRequestException(this.xMessage(response.data, 'X connection failed.'));
    }
    return response.data as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };
  }

  private async freshToken(account: { userId: string; accessToken: string; refreshToken: string | null; tokenExpiry: Date | null }) {
    if (!account.tokenExpiry || account.tokenExpiry.getTime() > Date.now() + 60_000) return account.accessToken;
    if (!account.refreshToken) throw new BadRequestException('Connect X again.');
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: account.refreshToken,
    });
    const response = await axios.post('https://api.x.com/2/oauth2/token', body.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`,
      },
      validateStatus: () => true,
    });
    if (response.status >= 400 || !response.data?.access_token) {
      throw new BadRequestException('Connect X again.');
    }
    const expiry = response.data.expires_in ? new Date(Date.now() + response.data.expires_in * 1000) : null;
    await prisma.xAccount.update({
      where: { userId: account.userId },
      data: {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token || account.refreshToken,
        tokenExpiry: expiry,
      },
    });
    return response.data.access_token as string;
  }

  private async revoke(token: string, hint: 'access_token' | 'refresh_token') {
    const body = new URLSearchParams({ token, token_type_hint: hint });
    await axios.post('https://api.x.com/2/oauth2/revoke', body.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`,
      },
      validateStatus: () => true,
    });
  }

  private async fetchMe(accessToken: string) {
    const response = await axios.get('https://api.x.com/2/users/me', {
      params: { 'user.fields': 'public_metrics,profile_image_url,username,name' },
      headers: { Authorization: `Bearer ${accessToken}` },
      validateStatus: () => true,
    });
    if (response.status >= 400) return null;
    return response.data?.data as {
      id: string;
      name?: string;
      username?: string;
      profile_image_url?: string;
      public_metrics?: { followers_count?: number; following_count?: number; tweet_count?: number };
    } | undefined;
  }

  private async markConnected(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { connectedSocials: true } });
    if (!user || user.connectedSocials.includes('X')) return;
    await prisma.user.update({
      where: { id: userId },
      data: { connectedSocials: { set: [...user.connectedSocials, 'X'] } },
    });
  }

  private xMessage(data: unknown, fallback: string): string {
    if (!data || typeof data !== 'object') return fallback;
    const body = data as {
      error_description?: string;
      detail?: string;
      title?: string;
      errors?: { message?: string }[];
    };
    if (body.errors?.[0]?.message) return body.errors[0].message;
    if (body.error_description) return body.error_description;
    if (body.detail) return body.detail;
    if (body.title) return body.title;
    return fallback;
  }
}
