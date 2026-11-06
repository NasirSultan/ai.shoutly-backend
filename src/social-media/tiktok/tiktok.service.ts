import { BadRequestException, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import axios from 'axios';
import { prisma } from '../../lib/prisma';
import { RedisService } from '../../common/redis/redis.service';
import { withRefreshLock } from '../oauth-refresh-lock';
import { TiktokOptionsDto } from '../../outstand/dto/tiktok-options.dto';

const SCOPES = 'user.info.basic,user.info.profile,user.info.stats,video.list,video.publish,video.upload';

export type TikTokCreator = {
  username: string | null;
  nickname: string | null;
  avatarUrl: string | null;
  privacyLevelOptions: string[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoPostDurationSec: number | null;
};

@Injectable()
export class TiktokService {
  private readonly clientKey = process.env.TIKTOK_CLIENT_ID ?? '';
  private readonly clientSecret = process.env.TIKTOK_CLIENT_SECRET ?? '';

  constructor(private readonly redisService: RedisService) {}

  redirectUri(): string {
    if (process.env.TIKTOK_REDIRECT_URI) return process.env.TIKTOK_REDIRECT_URI;
    return 'https://backend.shoutlyai.com/api/tiktok/callback';
  }

  async authUrl(userId: string, shoutlyToken: string): Promise<string> {
    if (!this.clientKey || !this.clientSecret) {
      throw new BadRequestException('TikTok app credentials are missing on the server.');
    }
    const state = randomBytes(16).toString('base64url');
    await this.redisService.getClient().set(
      `tiktok:oauth:${state}`,
      JSON.stringify({ userId }),
      { EX: 600 },
    );
    const params = new URLSearchParams({
      client_key: this.clientKey,
      response_type: 'code',
      scope: SCOPES,
      redirect_uri: this.redirectUri(),
      state,
    });
    return `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;
  }

  async takePending(state: string): Promise<{ userId: string } | null> {
    const key = `tiktok:oauth:${state}`;
    const raw = await this.redisService.getClient().get(key);
    if (!raw) return null;
    await this.redisService.getClient().del(key);
    const parsed = JSON.parse(raw) as { userId?: string };
    if (!parsed.userId) return null;
    return { userId: parsed.userId };
  }

  async connectFromCode(code: string, userId: string) {
    const token = await this.exchangeCode(code);
    const granted = new Set((token.scope || '').split(/[,\s]+/).filter(Boolean));
    if (!granted.has('video.publish') || !granted.has('user.info.basic')) {
      throw new BadRequestException('TikTok did not grant permission to post. Connect again and allow posting.');
    }
    const profile = await this.fetchUser(token.access_token);
    const expiry = token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null;
    const refreshExpiry = token.refresh_expires_in ? new Date(Date.now() + token.refresh_expires_in * 1000) : null;
    const data = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      scopes: token.scope || SCOPES,
      tokenExpiry: expiry,
      refreshExpiry,
      openId: token.open_id || profile?.open_id || null,
      unionId: profile?.union_id ?? null,
      username: profile?.username ?? null,
      displayName: profile?.display_name ?? null,
      avatarUrl: profile?.avatar_url ?? null,
      followerCount: profile?.follower_count != null ? String(profile.follower_count) : null,
      followingCount: profile?.following_count != null ? String(profile.following_count) : null,
      likesCount: profile?.likes_count != null ? String(profile.likes_count) : null,
      videoCount: profile?.video_count != null ? String(profile.video_count) : null,
    };
    const existing = await prisma.tiktokAccount.findUnique({ where: { userId } });
    if (existing) {
      await prisma.tiktokAccount.update({
        where: { userId },
        data: { ...data, refreshToken: token.refresh_token || existing.refreshToken },
      });
    } else {
      await prisma.tiktokAccount.create({ data: { userId, ...data } });
    }
    await this.markConnected(userId);
  }

  async status(userId: string) {
    const account = await prisma.tiktokAccount.findUnique({ where: { userId } });
    if (!account) {
      return { connected: false, expired: false, name: null, username: null, picture: null, followers: null };
    }
    return {
      connected: true,
      expired: !account.refreshToken,
      name: account.displayName,
      username: account.username,
      picture: account.avatarUrl,
      followers: account.followerCount,
    };
  }

  async creator(userId: string): Promise<TikTokCreator> {
    const account = await prisma.tiktokAccount.findUnique({ where: { userId } });
    if (!account) throw new BadRequestException('Connect TikTok before posting.');
    const token = await this.freshToken(account);
    const response = await axios.post('https://open.tiktokapis.com/v2/post/publish/creator_info/query/', {}, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      validateStatus: () => true,
    });
    this.assertOk(response.status, response.data, 'Could not read the TikTok account.');
    const info = response.data?.data || {};
    return {
      username: info.creator_username ?? account.username,
      nickname: info.creator_nickname ?? account.displayName,
      avatarUrl: info.creator_avatar_url ?? account.avatarUrl,
      privacyLevelOptions: info.privacy_level_options || [],
      commentDisabled: !!info.comment_disabled,
      duetDisabled: !!info.duet_disabled,
      stitchDisabled: !!info.stitch_disabled,
      maxVideoPostDurationSec: info.max_video_post_duration_sec ?? null,
    };
  }

  async disconnect(userId: string) {
    const account = await prisma.tiktokAccount.findUnique({ where: { userId } });
    if (account?.accessToken) {
      try {
        const body = new URLSearchParams({
          client_key: this.clientKey,
          client_secret: this.clientSecret,
          token: account.accessToken,
        });
        await axios.post('https://open.tiktokapis.com/v2/oauth/revoke/', body.toString(), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          validateStatus: () => true,
        });
      } catch {
        // Local disconnect still proceeds if TikTok already revoked the token.
      }
    }
    await prisma.tiktokAccount.deleteMany({ where: { userId } });
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { connectedSocials: true } });
    if (user?.connectedSocials.includes('TIKTOK')) {
      await prisma.user.update({
        where: { id: userId },
        data: { connectedSocials: { set: user.connectedSocials.filter((platform) => platform !== 'TIKTOK') } },
      });
    }
    return { success: true };
  }

  async publishForUser(userId: string, caption: string, mediaUrl: string | undefined, options?: TiktokOptionsDto) {
    if (!mediaUrl) throw new BadRequestException('TikTok requires a video.');
    if (!options?.privacyLevel) throw new BadRequestException('Choose a TikTok privacy level before posting.');
    const creator = await this.creator(userId);
    if (!creator.privacyLevelOptions.includes(options.privacyLevel)) {
      throw new BadRequestException('That privacy level is not available for this TikTok account.');
    }
    if (options.brandContent && options.privacyLevel === 'SELF_ONLY') {
      throw new BadRequestException('Branded content cannot be private on TikTok.');
    }
    const account = await prisma.tiktokAccount.findUnique({ where: { userId } });
    if (!account) throw new BadRequestException('Connect TikTok before posting.');
    const token = await this.freshToken(account);
    const file = await axios.get<ArrayBuffer>(mediaUrl, {
      responseType: 'arraybuffer',
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
    const bytes = Buffer.from(file.data);
    const contentType = String(file.headers['content-type'] || this.typeFromUrl(mediaUrl)).split(';')[0];
    if (contentType.startsWith('image/')) {
      return this.publishPhotos(token, caption, [mediaUrl], options);
    }
    return this.publishVideo(token, caption, bytes, contentType, options);
  }

  private async publishVideo(token: string, caption: string, bytes: Buffer, contentType: string, options: TiktokOptionsDto) {
    const plan = this.chunkPlan(bytes.length);
    const init = await axios.post('https://open.tiktokapis.com/v2/post/publish/video/init/', {
      post_info: this.postInfo(caption, options),
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: bytes.length,
        chunk_size: plan.chunkSize,
        total_chunk_count: plan.count,
      },
    }, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
      validateStatus: () => true,
    });
    this.assertOk(init.status, init.data, 'TikTok did not accept the video.');
    const publishId = init.data?.data?.publish_id as string | undefined;
    const uploadUrl = init.data?.data?.upload_url as string | undefined;
    if (!publishId || !uploadUrl) throw new BadRequestException('TikTok did not accept the video.');
    for (let index = 0; index < plan.count; index += 1) {
      const start = index * plan.chunkSize;
      const end = index === plan.count - 1 ? bytes.length : start + plan.chunkSize;
      const chunk = bytes.subarray(start, end);
      const uploaded = await axios.put(uploadUrl, chunk, {
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(chunk.length),
          'Content-Range': `bytes ${start}-${end - 1}/${bytes.length}`,
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        validateStatus: () => true,
      });
      const expected = index === plan.count - 1 ? 201 : 206;
      if (uploaded.status !== expected && uploaded.status >= 300) {
        throw new BadRequestException('TikTok did not accept the video.');
      }
    }
    return { publishId };
  }

  private async publishPhotos(token: string, caption: string, urls: string[], options: TiktokOptionsDto) {
    const init = await axios.post('https://open.tiktokapis.com/v2/post/publish/content/init/', {
      media_type: 'PHOTO',
      post_mode: 'DIRECT_POST',
      post_info: {
        title: caption.slice(0, 90),
        description: caption.slice(0, 4000),
        privacy_level: options.privacyLevel,
        disable_comment: options.disableComment !== false,
        auto_add_music: true,
        brand_content_toggle: !!options.brandContent,
        brand_organic_toggle: !!options.brandOrganic,
        is_aigc: !!options.isAigc,
      },
      source_info: { source: 'PULL_FROM_URL', photo_images: urls.slice(0, 35), photo_cover_index: 0 },
    }, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      validateStatus: () => true,
    });
    this.assertOk(init.status, init.data, 'TikTok did not accept the photos.');
    const publishId = init.data?.data?.publish_id as string | undefined;
    if (!publishId) throw new BadRequestException('TikTok did not accept the photos.');
    return { publishId };
  }

  private postInfo(caption: string, options: TiktokOptionsDto) {
    return {
      title: caption.slice(0, 2200),
      privacy_level: options.privacyLevel,
      disable_duet: options.disableDuet !== false,
      disable_comment: options.disableComment !== false,
      disable_stitch: options.disableStitch !== false,
      brand_content_toggle: !!options.brandContent,
      brand_organic_toggle: !!options.brandOrganic,
      is_aigc: !!options.isAigc,
    };
  }

  private chunkPlan(size: number) {
    const maxSingle = 64 * 1024 * 1024;
    if (size <= maxSingle) return { chunkSize: size, count: 1 };
    const chunkSize = 10 * 1024 * 1024;
    return { chunkSize, count: Math.floor(size / chunkSize) };
  }

  private typeFromUrl(url: string) {
    const path = url.split('?')[0].toLowerCase();
    if (path.endsWith('.mov')) return 'video/quicktime';
    if (path.endsWith('.webm')) return 'video/webm';
    if (path.endsWith('.png')) return 'image/png';
    if (path.endsWith('.webp')) return 'image/webp';
    if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
    return 'video/mp4';
  }

  private async exchangeCode(code: string) {
    const body = new URLSearchParams({
      client_key: this.clientKey,
      client_secret: this.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: this.redirectUri(),
    });
    const response = await axios.post('https://open.tiktokapis.com/v2/oauth/token/', body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      validateStatus: () => true,
    });
    if (response.status >= 400 || !response.data?.access_token) {
      throw new BadRequestException(this.tiktokMessage(response.data, 'TikTok connection failed.'));
    }
    return response.data as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      refresh_expires_in?: number;
      open_id?: string;
      scope?: string;
    };
  }

  private async freshToken(account: { userId: string; accessToken: string; refreshToken: string | null; tokenExpiry: Date | null }) {
    if (!account.tokenExpiry || account.tokenExpiry.getTime() > Date.now() + 60_000) return account.accessToken;
    return withRefreshLock(this.redisService, 'tiktok', account.userId, async () => {
      const latest = await prisma.tiktokAccount.findUnique({ where: { userId: account.userId } });
      if (!latest?.refreshToken) throw new BadRequestException('Connect TikTok again.');
      if (!latest.tokenExpiry || latest.tokenExpiry.getTime() > Date.now() + 60_000) return latest.accessToken;
      const body = new URLSearchParams({
        client_key: this.clientKey,
        client_secret: this.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: latest.refreshToken,
      });
      const response = await axios.post('https://open.tiktokapis.com/v2/oauth/token/', body.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        validateStatus: () => true,
      });
      if (response.status >= 400 || !response.data?.access_token) {
        throw new BadRequestException('Connect TikTok again.');
      }
      const expiry = response.data.expires_in ? new Date(Date.now() + response.data.expires_in * 1000) : null;
      const refreshExpiry = response.data.refresh_expires_in ? new Date(Date.now() + response.data.refresh_expires_in * 1000) : null;
      await prisma.tiktokAccount.update({
        where: { userId: account.userId },
        data: {
          accessToken: response.data.access_token,
          refreshToken: response.data.refresh_token || latest.refreshToken,
          tokenExpiry: expiry,
          refreshExpiry,
        },
      });
      return response.data.access_token as string;
    });
  }

  private async fetchUser(accessToken: string) {
    const response = await axios.get('https://open.tiktokapis.com/v2/user/info/', {
      params: { fields: 'open_id,union_id,avatar_url,display_name,username,follower_count,following_count,likes_count,video_count' },
      headers: { Authorization: `Bearer ${accessToken}` },
      validateStatus: () => true,
    });
    const code = response.data?.error?.code;
    if (response.status >= 400 || (code && code !== 'ok')) return null;
    return response.data?.data?.user as {
      open_id?: string;
      union_id?: string;
      avatar_url?: string;
      display_name?: string;
      username?: string;
      follower_count?: number;
      following_count?: number;
      likes_count?: number;
      video_count?: number;
    } | undefined;
  }

  private assertOk(status: number, data: unknown, fallback: string) {
    const code = data && typeof data === 'object' && 'error' in data
      ? (data as { error?: { code?: string } }).error?.code
      : undefined;
    if (status >= 400 || (code && code !== 'ok')) {
      throw new BadRequestException(this.tiktokMessage(data, fallback));
    }
  }

  private async markConnected(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { connectedSocials: true } });
    if (!user || user.connectedSocials.includes('TIKTOK')) return;
    await prisma.user.update({
      where: { id: userId },
      data: { connectedSocials: { set: [...user.connectedSocials, 'TIKTOK'] } },
    });
  }

  private tiktokMessage(data: unknown, fallback: string): string {
    if (!data || typeof data !== 'object') return fallback;
    const body = data as { error?: { message?: string; code?: string }; error_description?: string; message?: string };
    if (body.error?.message && body.error.message !== 'ok') return body.error.message;
    if (body.error_description) return body.error_description;
    if (body.message) return body.message;
    return fallback;
  }
}
