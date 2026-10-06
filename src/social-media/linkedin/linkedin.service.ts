import { BadRequestException, Injectable } from '@nestjs/common';
import axios from 'axios';
import { prisma } from '../../lib/prisma';

const LINKEDIN_VERSION = '202609';
const SCOPES = 'openid profile email w_member_social';

type TokenResponse = {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
};

type UserInfo = {
  sub: string;
  name?: string;
  picture?: string;
  email?: string;
};

@Injectable()
export class LinkedInService {
  private readonly clientId = process.env.linkedin_client_id ?? '';
  private readonly clientSecret = process.env.linkedin_client_secret ?? '';

  redirectUri(): string {
    if (process.env.LINKEDIN_REDIRECT_URI) return process.env.LINKEDIN_REDIRECT_URI;
    const front = process.env.FRONTEND_URL || '';
    if (front.includes('localhost')) return 'http://localhost:4000/api/linkedin/callback';
    return 'https://backend.shoutlyai.com/api/linkedin/callback';
  }

  authUrl(state: string): string {
    this.assertCredentials();
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: this.redirectUri(),
      state,
      scope: SCOPES,
    });
    return `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
  }

  async connectFromCode(code: string, userId: string) {
    this.assertCredentials();
    const token = await this.exchangeCode(code);
    const profile = await this.fetchUserInfo(token.access_token);
    if (!profile.sub) throw new BadRequestException('LinkedIn did not return a member id.');

    const tokenExpiry = token.expires_in
      ? new Date(Date.now() + token.expires_in * 1000)
      : null;

    const existing = await prisma.linkedAccount.findFirst({
      where: { userId, platform: 'LINKEDIN' },
      orderBy: { createdAt: 'desc' },
    });

    const data = {
      platformUserId: profile.sub,
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? null,
      scopes: token.scope || SCOPES,
      tokenExpiry,
    };

    const account = existing
      ? await prisma.linkedAccount.update({ where: { id: existing.id }, data })
      : await prisma.linkedAccount.create({
          data: { userId, platform: 'LINKEDIN', ...data },
        });

    await this.markConnected(userId);
    return account;
  }

  async status(userId: string) {
    const account = await prisma.linkedAccount.findFirst({
      where: { userId, platform: 'LINKEDIN' },
      orderBy: { createdAt: 'desc' },
    });
    if (!account) return { connected: false, expired: false, name: null, picture: null };

    const expired = !!account.tokenExpiry && account.tokenExpiry.getTime() <= Date.now();
    let name: string | null = null;
    let picture: string | null = null;
    if (!expired) {
      try {
        const profile = await this.fetchUserInfo(account.accessToken);
        name = profile.name ?? null;
        picture = profile.picture ?? null;
      } catch {
        name = null;
      }
    }

    return { connected: true, expired, name, picture };
  }

  async disconnect(userId: string) {
    await prisma.linkedAccount.deleteMany({ where: { userId, platform: 'LINKEDIN' } });
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { connectedSocials: true },
    });
    if (user?.connectedSocials.includes('LINKEDIN')) {
      await prisma.user.update({
        where: { id: userId },
        data: {
          connectedSocials: { set: user.connectedSocials.filter((p) => p !== 'LINKEDIN') },
        },
      });
    }
    return { success: true };
  }

  async publish(input: {
    accessToken: string;
    personId: string;
    commentary: string;
    mediaUrl?: string;
    video?: boolean;
  }): Promise<string> {
    const author = `urn:li:person:${input.personId}`;
    const commentary = (input.commentary || '').trim();
    if (!commentary && !input.mediaUrl) {
      throw new BadRequestException('A LinkedIn post needs text or media.');
    }
    if (commentary.length > 3000) {
      throw new BadRequestException('LinkedIn captions cannot be longer than 3000 characters.');
    }

    const body: Record<string, unknown> = {
      author,
      commentary,
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    };

    if (input.mediaUrl) {
      const bytes = await this.download(input.mediaUrl);
      const video = input.video || this.looksLikeVideo(input.mediaUrl);
      const mediaId = video
        ? await this.uploadVideo(input.accessToken, author, bytes)
        : await this.uploadImage(input.accessToken, author, bytes);
      body.content = { media: { id: mediaId } };
    }

    const response = await axios.post('https://api.linkedin.com/rest/posts', body, {
      headers: this.headers(input.accessToken),
      validateStatus: () => true,
    });

    if (response.status !== 201) {
      throw new BadRequestException(this.linkedinMessage(response.data, 'LinkedIn rejected the post.'));
    }

    const id = response.headers['x-restli-id'];
    return typeof id === 'string' ? id : '';
  }

  private async markConnected(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { connectedSocials: true },
    });
    if (!user || user.connectedSocials.includes('LINKEDIN')) return;
    await prisma.user.update({
      where: { id: userId },
      data: { connectedSocials: { set: [...user.connectedSocials, 'LINKEDIN'] } },
    });
  }

  private assertCredentials() {
    if (!this.clientId || !this.clientSecret) {
      throw new BadRequestException('LinkedIn app credentials are not configured.');
    }
  }

  private async exchangeCode(code: string): Promise<TokenResponse> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: this.redirectUri(),
    });
    const response = await axios.post('https://www.linkedin.com/oauth/v2/accessToken', body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      validateStatus: () => true,
    });
    if (response.status !== 200 || !response.data?.access_token) {
      throw new BadRequestException(this.linkedinMessage(response.data, 'LinkedIn token exchange failed.'));
    }
    return response.data as TokenResponse;
  }

  private async fetchUserInfo(accessToken: string): Promise<UserInfo> {
    const response = await axios.get('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
      validateStatus: () => true,
    });
    if (response.status !== 200) {
      throw new BadRequestException(this.linkedinMessage(response.data, 'Could not read the LinkedIn profile.'));
    }
    return response.data as UserInfo;
  }

  private async download(url: string): Promise<Buffer> {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 120000,
      maxContentLength: 200 * 1024 * 1024,
    });
    return Buffer.from(response.data);
  }

  private looksLikeVideo(url: string): boolean {
    const path = url.split('?')[0].toLowerCase();
    return path.endsWith('.mp4') || path.endsWith('.mov');
  }

  private async uploadImage(accessToken: string, owner: string, bytes: Buffer): Promise<string> {
    const init = await axios.post(
      'https://api.linkedin.com/rest/images?action=initializeUpload',
      { initializeUploadRequest: { owner } },
      { headers: this.headers(accessToken), validateStatus: () => true },
    );
    const uploadUrl = init.data?.value?.uploadUrl;
    const image = init.data?.value?.image;
    if (init.status !== 200 || !uploadUrl || !image) {
      throw new BadRequestException(this.linkedinMessage(init.data, 'LinkedIn image upload could not start.'));
    }
    await this.putBytes(accessToken, uploadUrl, bytes);
    return image as string;
  }

  private async uploadVideo(accessToken: string, owner: string, bytes: Buffer): Promise<string> {
    const init = await axios.post(
      'https://api.linkedin.com/rest/videos?action=initializeUpload',
      {
        initializeUploadRequest: {
          owner,
          fileSizeBytes: bytes.length,
          uploadCaptions: false,
          uploadThumbnail: false,
        },
      },
      { headers: this.headers(accessToken), validateStatus: () => true },
    );
    const value = init.data?.value;
    const instructions = value?.uploadInstructions as Array<{ uploadUrl: string; firstByte: number; lastByte: number }> | undefined;
    if (init.status !== 200 || !value?.video || !instructions?.length) {
      throw new BadRequestException(this.linkedinMessage(init.data, 'LinkedIn video upload could not start.'));
    }

    const partIds: string[] = [];
    for (const part of instructions) {
      const chunk = bytes.subarray(part.firstByte, part.lastByte + 1);
      const etag = await this.putBytes(accessToken, part.uploadUrl, chunk);
      if (etag) partIds.push(etag);
    }

    const finalize = await axios.post(
      'https://api.linkedin.com/rest/videos?action=finalizeUpload',
      {
        finalizeUploadRequest: {
          video: value.video,
          uploadToken: value.uploadToken || '',
          uploadedPartIds: partIds,
        },
      },
      { headers: this.headers(accessToken), validateStatus: () => true },
    );
    if (finalize.status !== 200) {
      throw new BadRequestException(this.linkedinMessage(finalize.data, 'LinkedIn video upload did not finish.'));
    }
    return value.video as string;
  }

  private async putBytes(accessToken: string, uploadUrl: string, bytes: Buffer): Promise<string> {
    const response = await axios.put(uploadUrl, bytes, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/octet-stream',
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      validateStatus: () => true,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new BadRequestException('LinkedIn media upload failed.');
    }
    const etag = response.headers?.etag;
    return typeof etag === 'string' ? etag : '';
  }

  private headers(accessToken: string) {
    return {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
      'Linkedin-Version': LINKEDIN_VERSION,
    };
  }

  private linkedinMessage(data: unknown, fallback: string): string {
    if (!data || typeof data !== 'object') return fallback;
    const body = data as { message?: string; error_description?: string; error?: string };
    return body.message || body.error_description || body.error || fallback;
  }
}
