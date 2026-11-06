import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import axios from 'axios';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { prisma } from '../../lib/prisma';
import { RedisService } from '../../common/redis/redis.service';
import { PostPublishedEvent } from '../../events/post-published.event';
import { DirectPostDto } from './dto/post.dto';

type FacebookPageNode = { id: string; name: string; access_token?: string; tasks?: string[] };

// business_management is required. Without it, /me/accounts hides every Page
// the person only reaches through a Meta Business — which is an empty list
// even when they tick "all Pages" on the consent screen.
const SCOPES = [
  'public_profile',
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'business_management',
];

// Facebook only accepts a scheduled time between 10 minutes and 30 days ahead.
const MIN_SCHEDULE_AHEAD_MS = 10 * 60 * 1000;
const MAX_SCHEDULE_AHEAD_MS = 30 * 24 * 60 * 60 * 1000;

export interface FacebookPublishOptions {
  // Treat the (first) media URL as a video even if the URL doesn't end in a
  // video extension, e.g. a calendar reel.
  isVideo?: boolean;
  // When set, Facebook holds the post and publishes it at this time itself.
  scheduledAt?: Date;
}

// Publishes straight to the user's Facebook Page through the Graph API
// (no Outstand in between). A user connects once through GET /facebook/auth;
// we keep the long-lived user token plus one token per Page, and posts go to
// the Page marked isDefault (or the first Page if none is marked).
@Injectable()
export class FacebookService {
  private readonly appId = process.env.FB_APP_ID || process.env.META_APP_ID || '';
  private readonly appSecret = process.env.FB_APP_SECRET || process.env.META_APP_SECRET || '';
  private readonly version = process.env.FB_GRAPH_VERSION || 'v23.0';

  constructor(
    private readonly redisService: RedisService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private get graph() {
    return `https://graph.facebook.com/${this.version}`;
  }

  redirectUri(): string {
    if (process.env.FB_REDIRECT_URI) return process.env.FB_REDIRECT_URI;
    const front = process.env.FRONTEND_URL || '';
    if (front.includes('localhost')) return 'http://localhost:4000/api/facebook/callback';
    return 'https://backend.shoutlyai.com/api/facebook/callback';
  }

  // ── OAuth ──

  async authUrl(userId: string, shoutlyToken: string): Promise<string> {
    if (!this.appId || !this.appSecret) {
      throw new BadRequestException('Facebook app credentials are missing on the server.');
    }
    // A random value, not the user's login token: the state travels through
    // Facebook's URLs, so it must not carry anything secret.
    const state = randomBytes(16).toString('base64url');
    await this.redisService.getClient().set(
      `fb:oauth:${state}`,
      JSON.stringify({ userId, token: shoutlyToken }),
      { EX: 600 },
    );
    // A saved Login configuration (FB_CONFIG_ID) replaces this scope list.
    // That configuration does not include business_management, so Meta keeps
    // returning zero Pages. Use it only after the configuration asks for
    // business_management: set FB_USE_LOGIN_CONFIG=true.
    const configId = process.env.FB_USE_LOGIN_CONFIG === 'true' ? process.env.FB_CONFIG_ID : '';
    const params = new URLSearchParams({
      client_id: this.appId,
      redirect_uri: this.redirectUri(),
      state,
      response_type: 'code',
      // Always show the permission screen again. Without this, Facebook
      // reuses the earlier "no Pages" grant and never asks for business access.
      auth_type: 'rerequest',
      ...(configId
        ? { config_id: configId, override_default_response_type: 'true' }
        : { scope: SCOPES.join(',') }),
    });
    return `https://www.facebook.com/${this.version}/dialog/oauth?${params.toString()}`;
  }

  async takePending(state: string): Promise<{ userId: string; token: string } | null> {
    const key = `fb:oauth:${state}`;
    const raw = await this.redisService.getClient().getDel(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { userId?: string; token?: string };
    if (!parsed.userId || !parsed.token) return null;
    return { userId: parsed.userId, token: parsed.token };
  }

  async connectFromCode(code: string, userId: string) {
    const { data: short } = await this.call(() =>
      axios.get(`${this.graph}/oauth/access_token`, {
        params: {
          client_id: this.appId,
          client_secret: this.appSecret,
          redirect_uri: this.redirectUri(),
          code,
        },
      }),
    );

    // Swap for a long-lived user token. Page tokens fetched with it don't expire.
    const { data: long } = await this.call(() =>
      axios.get(`${this.graph}/oauth/access_token`, {
        params: {
          grant_type: 'fb_exchange_token',
          client_id: this.appId,
          client_secret: this.appSecret,
          fb_exchange_token: short.access_token,
        },
      }),
    );

    // Facebook can finish the login without giving every permission (the
    // user turned one off, or the app is not allowed to ask for it). Without
    // pages_manage_posts every post fails later, so stop here with a clear
    // message instead of showing "connected".
    const granted = await this.grantedPermissions(long.access_token);
    const missing = ['pages_manage_posts', 'pages_read_engagement'].filter((p) => !granted.has(p));
    if (missing.length) {
      console.error('[Facebook connect] missing permissions:', missing.join(', '));
      throw new BadRequestException(
        'Facebook did not allow Shoutly to post to your Page. Please connect again and allow every permission.',
      );
    }

    const pages = await this.fetchPages(long.access_token);
    if (!pages.length) {
      const debug = process.env.NODE_ENV === 'production' ? '' : ` [${this.pageDebug}]`;
      throw new BadRequestException(
        (granted.has('business_management')
          ? 'Facebook returned no Pages for the profile that clicked Allow. That profile needs Full control or Content access on the Page.'
          : 'Facebook hid your Pages because they belong to a Business. Connect again and allow business access.') + debug,
      );
    }

    const previousDefault = await prisma.facebookPage.findFirst({
      where: { facebookAccount: { userId }, isDefault: true },
      select: { pageId: true },
    });
    // Keep the user's earlier choice if that Page is still shared; otherwise
    // default to the first Page so posting works straight away.
    const defaultPageId =
      previousDefault && pages.some((p) => p.id === previousDefault.pageId)
        ? previousDefault.pageId
        : pages[0].id;

    await prisma.$transaction(async (tx) => {
      const account = await tx.facebookAccount.upsert({
        where: { userId },
        update: { accessToken: long.access_token },
        create: { userId, accessToken: long.access_token },
      });
      await tx.facebookPage.deleteMany({ where: { facebookAccountId: account.id } });
      await tx.facebookPage.createMany({
        data: pages.map((page) => ({
          facebookAccountId: account.id,
          pageId: page.id,
          pageName: page.name,
          pageAccessToken: page.access_token,
          isDefault: page.id === defaultPageId,
        })),
      });
    });

    await this.markConnected(userId);
    return { pages: pages.length, defaultPageId };
  }

  private async grantedPermissions(userToken: string) {
    const { data } = await this.call(() =>
      axios.get(`${this.graph}/me/permissions`, { params: { access_token: userToken } }),
    );
    return new Set(
      ((data?.data ?? []) as { permission: string; status: string }[])
        .filter((p) => p.status === 'granted')
        .map((p) => p.permission),
    );
  }

  private async fetchPages(userToken: string) {
    const pages = await this.listEdge(`${this.graph}/me/accounts`, userToken, 'id,name,access_token,tasks');
    // With Facebook Login for Business, /me/accounts can come back empty even
    // though the user ticked Pages. Those Page IDs are listed on the token itself.
    // Pages that live in a Business are also missing until business_management
    // is granted; those are listed on the business, not on /me/accounts.
    this.pageDebug = `acc=${pages.length}`;
    if (!pages.length) pages.push(...(await this.fetchPagesFromGrantedScopes(userToken)));
    if (!pages.length) pages.push(...(await this.fetchPagesFromBusinesses(userToken)));
    const byId = new Map<string, FacebookPageNode & { access_token: string }>();
    for (const page of pages) {
      if (page?.id && page.access_token) byId.set(page.id, page as FacebookPageNode & { access_token: string });
    }
    const unique = [...byId.values()];
    // An empty tasks list means Facebook did not say either way. A Page token
    // is enough to post; drop a Page only when its tasks explicitly cannot post.
    const usable = unique.filter(
      (p) => !p.tasks?.length || p.tasks.includes('CREATE_CONTENT') || p.tasks.includes('MANAGE'),
    );
    this.pageDebug += ` usable=${usable.length}/${unique.length}`;
    return usable;
  }

  private async listEdge(url: string, token: string, fields: string) {
    const rows: FacebookPageNode[] = [];
    let next: string | null = url;
    let params: Record<string, string> | undefined = { access_token: token, fields, limit: '100' };
    while (next) {
      const { data } = await this.call(() => axios.get(next as string, { params }));
      rows.push(...((data?.data ?? []) as FacebookPageNode[]));
      next = data?.paging?.next ?? null;
      params = undefined; // the "next" link already carries every param
    }
    return rows;
  }

  // Pages owned by, or shared with, a Business the user can access.
  // /me/accounts does not return these unless the token also has business_management.
  private async fetchPagesFromBusinesses(userToken: string) {
    const found: FacebookPageNode[] = [];
    let businesses: { id: string }[] = [];
    try {
      businesses = await this.listEdge(`${this.graph}/me/businesses`, userToken, 'id,name');
    } catch (e) {
      this.pageDebug += ` businesses_err=${e instanceof Error ? e.message.slice(0, 60) : 'err'}`;
      return found;
    }
    this.pageDebug += ` businesses=${businesses.length}`;
    for (const biz of businesses) {
      for (const edge of ['owned_pages', 'client_pages'] as const) {
        let listed: FacebookPageNode[] = [];
        try {
          listed = await this.listEdge(`${this.graph}/${biz.id}/${edge}`, userToken, 'id,name,access_token,tasks');
        } catch (e) {
          console.warn(`[Facebook connect] ${edge} failed: ${e instanceof Error ? e.message : e}`);
          continue;
        }
        for (const page of listed) {
          if (!page?.id) continue;
          if (page.access_token) {
            found.push(page);
            continue;
          }
          try {
            const { data } = await this.call(() =>
              axios.get(`${this.graph}/${page.id}`, {
                params: { access_token: userToken, fields: 'id,name,access_token,tasks' },
              }),
            );
            if (data?.access_token) found.push(data);
          } catch (e) {
            console.warn(`[Facebook connect] could not read Business Page ${page.id}: ${e instanceof Error ? e.message : e}`);
          }
        }
      }
    }
    this.pageDebug += ` biz_pages=${found.length}`;
    return found;
  }

  // Short note on why no Page was found. Shown in the error only outside production.
  private pageDebug = '';

  private async fetchPagesFromGrantedScopes(userToken: string) {
    const found: FacebookPageNode[] = [];
    try {
      const { data } = await this.call(() =>
        axios.get(`${this.graph}/debug_token`, {
          params: { input_token: userToken, access_token: `${this.appId}|${this.appSecret}` },
        }),
      );
      const scopes: { scope: string; target_ids?: string[] }[] = data?.data?.granular_scopes ?? [];
      const ids = new Set<string>();
      for (const s of scopes) {
        if (['pages_show_list', 'pages_manage_posts', 'pages_read_engagement', 'business_management'].includes(s.scope)) {
          (s.target_ids ?? []).forEach((id) => ids.add(id));
        }
      }
      console.log(`[Facebook connect] /me/accounts was empty; token grants ${ids.size} Page(s)`);
      this.pageDebug += ` granted=${ids.size} scopes=${scopes.map((s) => `${s.scope}:${s.target_ids?.length ?? 0}`).join('|')}`;
      for (const id of ids) {
        try {
          const { data: page } = await this.call(() =>
            axios.get(`${this.graph}/${id}`, {
              params: { access_token: userToken, fields: 'id,name,access_token,tasks' },
            }),
          );
          if (page?.access_token) found.push(page);
        } catch (e) {
          console.warn(`[Facebook connect] could not read Page ${id}: ${e instanceof Error ? e.message : e}`);
        }
      }
    } catch (e) {
      console.warn(`[Facebook connect] debug_token failed: ${e instanceof Error ? e.message : e}`);
      this.pageDebug += ` debug_token_failed=${e instanceof Error ? e.message.slice(0, 40) : 'err'}`;
    }
    return found;
  }

  // ── Pages / status ──

  async getPages(userId: string) {
    const account = await prisma.facebookAccount.findUnique({
      where: { userId },
      include: { pages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!account) throw new NotFoundException('Facebook is not connected.');
    return account.pages.map((p) => ({ id: p.id, pageId: p.pageId, pageName: p.pageName, isDefault: p.isDefault }));
  }

  async selectPage(userId: string, pageId: string) {
    if (!pageId) throw new BadRequestException('pageId is required.');
    const account = await prisma.facebookAccount.findUnique({
      where: { userId },
      include: { pages: true },
    });
    if (!account) throw new NotFoundException('Facebook is not connected.');
    if (!account.pages.some((p) => p.pageId === pageId)) {
      throw new BadRequestException('That Page is not connected to your account.');
    }
    await prisma.$transaction([
      prisma.facebookPage.updateMany({ where: { facebookAccountId: account.id }, data: { isDefault: false } }),
      prisma.facebookPage.updateMany({ where: { facebookAccountId: account.id, pageId }, data: { isDefault: true } }),
    ]);
    return { success: true, selectedPageId: pageId };
  }

  async status(userId: string) {
    const account = await prisma.facebookAccount.findUnique({
      where: { userId },
      include: { pages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!account) return { connected: false, expired: false, pages: [] };

    let expired = false;
    try {
      await axios.get(`${this.graph}/me`, { params: { access_token: account.accessToken, fields: 'id' } });
    } catch (error) {
      expired = this.isTokenError(error);
    }
    return {
      connected: account.pages.length > 0,
      expired,
      pages: account.pages.map((p) => ({ id: p.id, pageId: p.pageId, pageName: p.pageName, isDefault: p.isDefault })),
    };
  }

  // Removes one Page (by our FacebookPage.id). Disconnects Facebook entirely
  // when it was the last one.
  async removePage(userId: string, facebookPageRowId: string) {
    const page = await prisma.facebookPage.findFirst({
      where: { id: facebookPageRowId, facebookAccount: { userId } },
    });
    if (!page) return null;
    await prisma.facebookPage.delete({ where: { id: page.id } });
    const remaining = await prisma.facebookPage.findMany({ where: { facebookAccountId: page.facebookAccountId } });
    if (!remaining.length) {
      await this.disconnect(userId);
    } else if (page.isDefault) {
      await prisma.facebookPage.update({ where: { id: remaining[0].id }, data: { isDefault: true } });
    }
    return { success: true, message: 'FACEBOOK page disconnected' };
  }

  async disconnect(userId: string) {
    const account = await prisma.facebookAccount.findUnique({ where: { userId } });
    if (account) {
      try {
        await axios.delete(`${this.graph}/me/permissions`, { params: { access_token: account.accessToken } });
      } catch {
        // Local disconnect still proceeds if Facebook already revoked access.
      }
    }
    await prisma.facebookAccount.deleteMany({ where: { userId } });
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { connectedSocials: true } });
    if (user?.connectedSocials.includes('FACEBOOK')) {
      await prisma.user.update({
        where: { id: userId },
        data: { connectedSocials: { set: user.connectedSocials.filter((p) => p !== 'FACEBOOK') } },
      });
    }
    return { success: true };
  }

  async hasPostablePage(userId: string): Promise<boolean> {
    const count = await prisma.facebookPage.count({ where: { facebookAccount: { userId } } });
    return count > 0;
  }

  // ── Publishing ──

  // Posts to the user's default Page. Returns the Facebook post id.
  async publishForUser(
    userId: string,
    text: string,
    mediaUrls?: string[],
    options: FacebookPublishOptions = {},
  ): Promise<{ id: string; pageId: string; pageName: string | null }> {
    const page = await this.defaultPage(userId);
    const message = (text || '').trim();
    const urls = (mediaUrls || []).map((u) => u.trim()).filter(Boolean);
    if (!message && !urls.length) {
      throw new BadRequestException('Write a caption or attach media before posting to Facebook.');
    }

    const schedule = this.scheduleParams(options.scheduledAt);
    const token = page.pageAccessToken;
    const video = urls.find((u) => options.isVideo || this.looksLikeVideo(u));
    let id: string;

    if (video) {
      const { data } = await this.call(() =>
        axios.post(`${this.graph}/${page.pageId}/videos`, {
          file_url: video,
          description: message,
          access_token: token,
          ...schedule,
        }),
      );
      id = data.post_id || data.id;
    } else if (urls.length === 1) {
      const { data } = await this.call(() =>
        axios.post(`${this.graph}/${page.pageId}/photos`, {
          url: urls[0],
          caption: message,
          access_token: token,
          ...schedule,
        }),
      );
      id = data.post_id || data.id;
    } else if (urls.length > 1) {
      // Several photos in one post: upload each one hidden, then attach them all to one feed post.
      const mediaIds: string[] = [];
      for (const url of urls.slice(0, 10)) {
        const { data } = await this.call(() =>
          axios.post(`${this.graph}/${page.pageId}/photos`, {
            url,
            published: false,
            ...(schedule.scheduled_publish_time ? { temporary: true } : {}),
            access_token: token,
          }),
        );
        mediaIds.push(data.id);
      }
      const { data } = await this.call(() =>
        axios.post(`${this.graph}/${page.pageId}/feed`, {
          message,
          attached_media: mediaIds.map((media_fbid) => ({ media_fbid })),
          access_token: token,
          ...schedule,
        }),
      );
      id = data.id;
    } else {
      const { data } = await this.call(() =>
        axios.post(`${this.graph}/${page.pageId}/feed`, {
          message,
          access_token: token,
          ...schedule,
        }),
      );
      id = data.id;
    }

    return { id, pageId: page.pageId, pageName: page.pageName };
  }

  // Deletes a post (or a still-scheduled post) from the user's Page.
  async deletePostForUser(userId: string, facebookPostId: string) {
    const page = await this.defaultPage(userId);
    try {
      await axios.delete(`${this.graph}/${facebookPostId}`, { params: { access_token: page.pageAccessToken } });
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) return;
      throw this.toHttpError(error);
    }
  }

  // Kept for the existing POST /facebook/direct-post endpoint.
  async directPost(dto: DirectPostDto) {
    const parts = [
      dto.title,
      dto.message,
      dto.hashtags?.map((tag) => (tag.startsWith('#') ? tag : `#${tag}`)).join(' '),
    ].filter(Boolean);
    const result = await this.publishForUser(dto.userId, parts.join('\n\n'), dto.imageUrl ? [dto.imageUrl] : undefined);

    const user = await prisma.user.findUnique({
      where: { id: dto.userId },
      select: { email: true, name: true, timezone: true },
    });
    if (user?.email) {
      this.eventEmitter.emit(
        'post.published',
        new PostPublishedEvent(
          user.email,
          user.name || 'Creator',
          [{ platform: 'facebook', accountName: result.pageName || result.pageId }],
          new Date(),
          user.timezone,
        ),
      );
    }
    return result;
  }

  // ── helpers ──

  private async defaultPage(userId: string) {
    const pages = await prisma.facebookPage.findMany({
      where: { facebookAccount: { userId } },
      orderBy: { createdAt: 'asc' },
    });
    const page = pages.find((p) => p.isDefault) || pages[0];
    if (!page) throw new BadRequestException('Connect a Facebook Page before posting to Facebook.');
    return page;
  }

  private scheduleParams(scheduledAt?: Date): { published?: false; scheduled_publish_time?: number } {
    if (!scheduledAt) return {};
    const ahead = scheduledAt.getTime() - Date.now();
    if (Number.isNaN(ahead) || ahead < MIN_SCHEDULE_AHEAD_MS || ahead > MAX_SCHEDULE_AHEAD_MS) {
      throw new BadRequestException('Facebook can only schedule posts between 10 minutes and 30 days ahead.');
    }
    return { published: false, scheduled_publish_time: Math.floor(scheduledAt.getTime() / 1000) };
  }

  private looksLikeVideo(url: string) {
    return /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(url.split('?')[0]);
  }

  private isTokenError(error: unknown) {
    return axios.isAxiosError(error) && error.response?.data?.error?.code === 190;
  }

  // Runs a Graph API call and turns Facebook's error into a clear 400.
  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      throw this.toHttpError(error);
    }
  }

  private toHttpError(error: unknown) {
    if (error instanceof BadRequestException || error instanceof NotFoundException) return error;
    if (axios.isAxiosError(error)) {
      const fb = error.response?.data?.error;
      console.error('[Facebook Graph API]', fb || error.message);
      if (fb?.code === 190) {
        return new BadRequestException('Facebook access has expired. Please reconnect Facebook.');
      }
      return new BadRequestException(`Facebook rejected the request: ${fb?.message || error.message}`);
    }
    return error instanceof Error ? error : new Error(String(error));
  }

  private async markConnected(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { connectedSocials: true } });
    if (!user || user.connectedSocials.includes('FACEBOOK')) return;
    await prisma.user.update({
      where: { id: userId },
      data: { connectedSocials: { set: [...user.connectedSocials, 'FACEBOOK'] } },
    });
  }
}
