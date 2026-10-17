import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import type { BlueskyAccount } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { BlueskyOAuthService, BlueskyOAuthSession } from './bluesky-oauth.service';
import { RedisService } from '../../common/redis/redis.service';
import { withRefreshLock } from '../oauth-refresh-lock';

const PUBLIC_API = 'https://public.api.bsky.app/xrpc';
const MAX_GRAPHEMES = 300;
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 2_000_000;

type Facet = {
  index: { byteStart: number; byteEnd: number };
  features: Array<Record<string, string>>;
};

// What publishing needs from either kind of connection.
type Writer = {
  did: string;
  uploadBlob(bytes: Buffer, mime: string): Promise<unknown>;
  createRecord(record: Record<string, unknown>): Promise<{ uri: string; cid: string }>;
};

const EXPIRED_MESSAGE = 'Bluesky session expired. Connect the account again.';

@Injectable()
export class BlueskyService {
  private readonly logger = new Logger(BlueskyService.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly oauth: BlueskyOAuthService,
  ) {}

  // ── OAuth (recommended) ───────────────────────────────────────────────
  oauthEnabled() {
    return this.oauth.enabled;
  }

  async authUrl(userId: string, handle: string) {
    if (!this.oauth.enabled) throw new BadRequestException(this.oauth.disabledReason);
    const clean = (handle || '').trim().replace(/^@/, '');
    if (!clean) throw new BadRequestException('Enter your Bluesky handle, e.g. you.bsky.social.');
    try {
      return await this.oauth.authorizeUrl(userId, clean);
    } catch (error) {
      this.logger.warn(`Bluesky authorize failed for "${clean}": ${error instanceof Error ? error.message : error}`);
      throw new BadRequestException('Bluesky could not find that handle or its server. Check the handle and try again.');
    }
  }

  // Called by the OAuth callback once the user approved access.
  async connectFromOAuth(userId: string, session: BlueskyOAuthSession) {
    const did = session.did;
    const info = await session.getTokenInfo(false).catch(() => null);
    const pds = (info?.aud ? String(info.aud) : await this.pdsForDid(did)).replace(/\/$/, '');
    const profile = await this.publicProfile(did);
    const data = {
      did,
      handle: profile?.handle || did,
      pdsUrl: pds,
      authType: 'oauth',
      status: 'active',
      lastError: null,
      accessJwt: null,
      refreshJwt: null,
      tokenExpiry: null,
      displayName: profile?.displayName || null,
      avatarUrl: profile?.avatar || null,
      followersCount: profile?.followersCount != null ? String(profile.followersCount) : null,
      followsCount: profile?.followsCount != null ? String(profile.followsCount) : null,
      postsCount: profile?.postsCount != null ? String(profile.postsCount) : null,
    };
    await prisma.blueskyAccount.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data },
    });
    await this.markConnected(userId);
    return { success: true, handle: data.handle, did };
  }

  // ── App password (legacy fallback) ──────────────────────────────────────
  async connect(userId: string, handle: string, appPassword: string) {
    const cleanHandle = handle.trim().replace(/^@/, '');
    const password = appPassword.trim();
    if (!cleanHandle || !password) {
      throw new BadRequestException('Enter both your Bluesky handle and app password.');
    }

    const { did, pds } = await this.resolvePds(cleanHandle);
    const session = await this.xrpc(pds, 'com.atproto.server.createSession', {
      method: 'POST',
      data: { identifier: cleanHandle, password },
    });
    const profile = await this.publicProfile(session.did || did);
    const expiry = jwtExpiry(session.accessJwt);
    const data = {
      did: session.did || did,
      handle: session.handle || profile?.handle || cleanHandle,
      pdsUrl: pds,
      authType: 'app_password',
      status: 'active',
      lastError: null,
      accessJwt: session.accessJwt,
      refreshJwt: session.refreshJwt,
      tokenExpiry: expiry,
      displayName: profile?.displayName || null,
      avatarUrl: profile?.avatar || null,
      followersCount: profile?.followersCount != null ? String(profile.followersCount) : null,
      followsCount: profile?.followsCount != null ? String(profile.followsCount) : null,
      postsCount: profile?.postsCount != null ? String(profile.postsCount) : null,
    };

    await prisma.blueskyAccount.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data },
    });
    await this.markConnected(userId);
    return { success: true, handle: data.handle, did: data.did };
  }

  async status(userId: string) {
    let account = await prisma.blueskyAccount.findUnique({ where: { userId } });
    if (!account) return { connected: false, expired: false, oauth: this.oauth.enabled };

    // Check the session still works (refreshing it if due), then refresh the
    // public profile counts. A network error leaves the stored status as is.
    if (account.status !== 'expired') {
      try {
        await this.writer(account);
      } catch {
        // writer() already marked the account expired when that was the cause.
      }
      account = (await prisma.blueskyAccount.findUnique({ where: { userId } })) ?? account;
    }
    const profile = await this.publicProfile(account.did);
    if (profile) {
      account = await prisma.blueskyAccount.update({
        where: { userId },
        data: {
          handle: profile.handle || account.handle,
          displayName: profile.displayName ?? account.displayName,
          avatarUrl: profile.avatar ?? account.avatarUrl,
          followersCount: profile.followersCount != null ? String(profile.followersCount) : account.followersCount,
          followsCount: profile.followsCount != null ? String(profile.followsCount) : account.followsCount,
          postsCount: profile.postsCount != null ? String(profile.postsCount) : account.postsCount,
        },
      });
    }
    return {
      connected: true,
      expired: account.status === 'expired',
      authType: account.authType,
      oauth: this.oauth.enabled,
      name: account.displayName,
      username: account.handle,
      picture: account.avatarUrl,
      followers: account.followersCount,
      following: account.followsCount,
      posts: account.postsCount,
    };
  }

  async disconnect(userId: string) {
    const account = await prisma.blueskyAccount.findUnique({ where: { userId } });
    if (account?.authType === 'oauth') {
      // The OAuth session is stored per DID; only revoke it when no other
      // Shoutly user has connected the same Bluesky account.
      const others = await prisma.blueskyAccount.count({ where: { did: account.did, NOT: { userId } } });
      if (!others && this.oauth.enabled) {
        await this.oauth.revoke(account.did).catch(() => undefined);
      }
    } else if (account?.refreshJwt) {
      try {
        await axios.post(`${account.pdsUrl}/xrpc/com.atproto.server.deleteSession`, null, {
          headers: { Authorization: `Bearer ${account.refreshJwt}` },
          validateStatus: () => true,
        });
      } catch {
        // Local disconnect still proceeds if Bluesky already dropped the session.
      }
    }
    await prisma.blueskyAccount.deleteMany({ where: { userId } });
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { connectedSocials: true } });
    if (user?.connectedSocials.includes('BLUESKY')) {
      await prisma.user.update({
        where: { id: userId },
        data: { connectedSocials: { set: user.connectedSocials.filter((platform) => platform !== 'BLUESKY') } },
      });
    }
    return { success: true };
  }

  async publishForUser(userId: string, caption: string, mediaUrls?: string[]) {
    const account = await prisma.blueskyAccount.findUnique({ where: { userId } });
    if (!account) throw new BadRequestException('Connect Bluesky before posting to Bluesky.');
    if (account.status === 'expired') throw new BadRequestException(EXPIRED_MESSAGE);
    const text = (caption || '').trim();
    const images = await this.images(mediaUrls || []);
    if (!text && !images.length) {
      throw new BadRequestException('A Bluesky post needs text or an image.');
    }
    if (graphemeCount(text) > MAX_GRAPHEMES) {
      throw new BadRequestException('Bluesky posts can be at most 300 characters.');
    }

    const writer = await this.writer(account);
    const facets = await this.facets(text);
    const uploaded = await this.uploadImages(writer, images);
    const record: Record<string, unknown> = {
      $type: 'app.bsky.feed.post',
      text,
      createdAt: new Date().toISOString(),
      ...(facets.length ? { facets } : {}),
    };
    if (uploaded.length) {
      record.embed = { $type: 'app.bsky.embed.images', images: uploaded };
    }

    const created = await writer.createRecord(record);
    return { uri: created.uri, cid: created.cid };
  }

  // A ready-to-use connection for either auth type. Marks the account expired
  // (and throws a clear error) when the user has to reconnect.
  private async writer(account: BlueskyAccount): Promise<Writer> {
    if (account.authType === 'oauth') {
      let session: BlueskyOAuthSession;
      try {
        session = await this.oauth.restore(account.did);
      } catch (error) {
        if (!this.oauth.enabled || this.oauth.isAuthError(error)) {
          await this.markExpired(account.userId, error);
          throw new BadRequestException(EXPIRED_MESSAGE);
        }
        throw new BadRequestException('Bluesky could not be reached. Try again in a moment.');
      }
      const { Agent } = await import('@atproto/api');
      const agent = new Agent(session);
      return {
        did: account.did,
        uploadBlob: async (bytes, mime) => {
          const res = await agent.com.atproto.repo.uploadBlob(bytes, { encoding: mime });
          return res.data.blob;
        },
        createRecord: async (record) => {
          try {
            const res = await agent.com.atproto.repo.createRecord({
              repo: account.did,
              collection: 'app.bsky.feed.post',
              record,
            });
            return { uri: res.data.uri, cid: res.data.cid };
          } catch (error) {
            throw new BadRequestException(error instanceof Error ? error.message : 'Bluesky rejected the post.');
          }
        },
      };
    }

    const fresh = await this.freshSession(account);
    return {
      did: fresh.did,
      uploadBlob: async (bytes, mime) => {
        const res = await axios.post(`${fresh.pdsUrl}/xrpc/com.atproto.repo.uploadBlob`, bytes, {
          headers: { Authorization: `Bearer ${fresh.accessJwt}`, 'Content-Type': mime },
          maxBodyLength: MAX_IMAGE_BYTES + 1024,
          timeout: 30_000,
        });
        return res.data?.blob;
      },
      createRecord: async (record) => {
        const created = await this.xrpc(fresh.pdsUrl, 'com.atproto.repo.createRecord', {
          method: 'POST',
          token: fresh.accessJwt ?? undefined,
          data: { repo: fresh.did, collection: 'app.bsky.feed.post', record },
        });
        return { uri: created.uri as string, cid: created.cid as string };
      },
    };
  }

  private async markExpired(userId: string, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.blueskyAccount.updateMany({
      where: { userId },
      data: { status: 'expired', lastError: message.slice(0, 500) },
    });
  }

  // App-password sessions: refresh the access JWT when it is (nearly) expired.
  private async freshSession(current: BlueskyAccount) {
    const isFresh = (a: BlueskyAccount) =>
      !!a.accessJwt && !!a.tokenExpiry && a.tokenExpiry.getTime() - Date.now() > 60_000;
    if (isFresh(current)) return current;

    // One refresh at a time per user: refresh JWTs rotate, so a parallel
    // refresh with the same token would kill the session.
    return withRefreshLock(this.redisService, 'bluesky', current.userId, async () => {
      const account = await prisma.blueskyAccount.findUnique({ where: { userId: current.userId } });
      if (!account) throw new BadRequestException('Connect Bluesky before posting to Bluesky.');
      if (isFresh(account)) return account;
      return this.refreshAppPasswordSession(account);
    });
  }

  private async refreshAppPasswordSession(account: BlueskyAccount) {
    if (!account.refreshJwt) {
      await this.markExpired(account.userId, 'missing refresh token');
      throw new BadRequestException(EXPIRED_MESSAGE);
    }

    let response;
    try {
      response = await axios.post(`${account.pdsUrl}/xrpc/com.atproto.server.refreshSession`, null, {
        headers: { Authorization: `Bearer ${account.refreshJwt}` },
        timeout: 20_000,
        validateStatus: () => true,
      });
    } catch {
      throw new BadRequestException('Bluesky could not be reached. Try again in a moment.');
    }
    if (response.status >= 400 || !response.data?.accessJwt) {
      const code = response.data?.error;
      if (response.status === 400 || response.status === 401 || code === 'ExpiredToken' || code === 'InvalidToken') {
        await this.markExpired(account.userId, code || `HTTP ${response.status}`);
        throw new BadRequestException(EXPIRED_MESSAGE);
      }
      throw new BadRequestException('Bluesky could not be reached. Try again in a moment.');
    }
    const session = response.data;
    return prisma.blueskyAccount.update({
      where: { userId: account.userId },
      data: {
        accessJwt: session.accessJwt,
        refreshJwt: session.refreshJwt || account.refreshJwt,
        tokenExpiry: jwtExpiry(session.accessJwt),
        handle: session.handle || account.handle,
        did: session.did || account.did,
        status: 'active',
        lastError: null,
      },
    });
  }

  private async images(urls: string[]) {
    if (!urls.length) return [];
    if (urls.length > MAX_IMAGES) {
      throw new BadRequestException('Bluesky accepts up to 4 images.');
    }
    const images: Array<{ alt: string; pending: { mime: string; bytes: Buffer } }> = [];
    for (const url of urls) {
      const path = url.split('?')[0].toLowerCase();
      if (path.endsWith('.mp4') || path.endsWith('.mov') || path.endsWith('.webm')) {
        throw new BadRequestException('Bluesky accepts text and up to 4 images. Video is not available.');
      }
      let response;
      try {
        response = await axios.get<ArrayBuffer>(url, {
          responseType: 'arraybuffer',
          maxContentLength: MAX_IMAGE_BYTES + 1,
          timeout: 30_000,
          validateStatus: () => true,
        });
      } catch (error) {
        if (axios.isAxiosError(error) && /maxContentLength/i.test(error.message)) {
          throw new BadRequestException('Each Bluesky image must be 2 MB or smaller.');
        }
        throw new BadRequestException('Could not download the image for Bluesky.');
      }
      if (response.status >= 400) throw new BadRequestException('Could not download the image for Bluesky.');
      const mime = String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (mime.startsWith('video/')) {
        throw new BadRequestException('Bluesky accepts text and up to 4 images. Video is not available.');
      }
      if (!mime.startsWith('image/')) throw new BadRequestException('Bluesky could not read that file as an image.');
      const bytes = Buffer.from(response.data);
      if (bytes.length > MAX_IMAGE_BYTES) {
        throw new BadRequestException('Each Bluesky image must be 2 MB or smaller.');
      }
      images.push({ alt: '', pending: { mime, bytes } });
    }
    return images;
  }

  private async uploadImages(writer: Writer, images: Array<{ alt: string; pending: { mime: string; bytes: Buffer } }>) {
    const uploaded: Array<{ alt: string; image: unknown }> = [];
    for (const image of images) {
      let blob: unknown;
      try {
        blob = await writer.uploadBlob(image.pending.bytes, image.pending.mime);
      } catch (error) {
        if (error instanceof BadRequestException) throw error;
        throw new BadRequestException('Bluesky rejected the image.');
      }
      if (!blob) throw new BadRequestException('Bluesky rejected the image.');
      uploaded.push({ alt: image.alt, image: blob });
    }
    return uploaded;
  }

  private async facets(text: string): Promise<Facet[]> {
    const found: Array<{ start: number; end: number; feature: Record<string, string> }> = [];
    const urlRe = /https?:\/\/[^\s]+/gi;
    for (const match of text.matchAll(urlRe)) {
      const raw = match[0].replace(/[),.;!?]+$/, '');
      const start = match.index ?? 0;
      found.push({
        start,
        end: start + raw.length,
        feature: { $type: 'app.bsky.richtext.facet#link', uri: raw },
      });
    }
    const mentionRe = /(^|[\s])@([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+)/g;
    for (const match of text.matchAll(mentionRe)) {
      const handle = match[2];
      const start = (match.index ?? 0) + match[1].length;
      try {
        const resolved = await axios.get(`${PUBLIC_API}/com.atproto.identity.resolveHandle`, {
          params: { handle },
          timeout: 10_000,
        });
        if (resolved.data?.did) {
          found.push({
            start,
            end: start + 1 + handle.length,
            feature: { $type: 'app.bsky.richtext.facet#mention', did: resolved.data.did },
          });
        }
      } catch {
        // An unresolvable mention stays plain text.
      }
    }
    const tagRe = /(^|[\s])#([A-Za-z0-9_]{1,64})/g;
    for (const match of text.matchAll(tagRe)) {
      const tag = match[2];
      const start = (match.index ?? 0) + match[1].length;
      found.push({
        start,
        end: start + 1 + tag.length,
        feature: { $type: 'app.bsky.richtext.facet#tag', tag },
      });
    }

    found.sort((a, b) => a.start - b.start);
    const kept: typeof found = [];
    for (const item of found) {
      const previous = kept[kept.length - 1];
      if (previous && item.start < previous.end) continue;
      kept.push(item);
    }
    return kept.map((item) => ({
      index: { byteStart: utf8Length(text.slice(0, item.start)), byteEnd: utf8Length(text.slice(0, item.end)) },
      features: [item.feature],
    }));
  }

  private async resolvePds(handle: string) {
    let did: string;
    try {
      const resolved = await axios.get(`${PUBLIC_API}/com.atproto.identity.resolveHandle`, {
        params: { handle },
        timeout: 10_000,
      });
      did = resolved.data?.did;
    } catch {
      throw new BadRequestException('Bluesky could not find that handle.');
    }
    if (!did) throw new BadRequestException('Bluesky could not find that handle.');
    return { did, pds: await this.pdsForDid(did) };
  }

  private async pdsForDid(did: string): Promise<string> {
    const docUrl = did.startsWith('did:web:')
      ? `https://${did.slice('did:web:'.length).split(':')[0]}/.well-known/did.json`
      : `https://plc.directory/${encodeURIComponent(did)}`;
    const doc = await axios.get(docUrl, { timeout: 10_000, validateStatus: () => true });
    const services = Array.isArray(doc.data?.service) ? doc.data.service : [];
    const service = services.find((item) => {
      const type = item?.type;
      return type === 'AtprotoPersonalDataServer' || (Array.isArray(type) && type.includes('AtprotoPersonalDataServer'));
    });
    const endpoint = typeof service?.serviceEndpoint === 'string' ? service.serviceEndpoint : '';
    if (!endpoint.startsWith('https://')) {
      throw new BadRequestException('Bluesky did not return a server for that account.');
    }
    return endpoint.replace(/\/$/, '');
  }

  private async publicProfile(did: string) {
    try {
      const response = await axios.get(`${PUBLIC_API}/app.bsky.actor.getProfile`, {
        params: { actor: did },
        timeout: 10_000,
        validateStatus: () => true,
      });
      return response.status < 400 ? response.data : null;
    } catch {
      return null;
    }
  }

  private async xrpc(pds: string, method: string, options: { method: 'GET' | 'POST'; token?: string; data?: unknown }) {
    try {
      const response = await axios.request({
        url: `${pds}/xrpc/${method}`,
        method: options.method,
        data: options.data,
        headers: {
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
          ...(options.data ? { 'Content-Type': 'application/json' } : {}),
        },
        timeout: 20_000,
        validateStatus: () => true,
      });
      if (response.status >= 400 || response.data?.error) {
        throw new BadRequestException(response.data?.message || response.data?.error || 'Bluesky rejected the request.');
      }
      return response.data;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('Bluesky could not be reached.');
    }
  }

  private async markConnected(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { connectedSocials: true } });
    if (!user || user.connectedSocials.includes('BLUESKY')) return;
    await prisma.user.update({
      where: { id: userId },
      data: { connectedSocials: { set: [...user.connectedSocials, 'BLUESKY'] } },
    });
  }
}

function graphemeCount(text: string) {
  if (!text) return 0;
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].length;
  }
  return [...text].length;
}

function utf8Length(text: string) {
  return Buffer.byteLength(text, 'utf8');
}

function jwtExpiry(token: string): Date | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return typeof payload.exp === 'number' ? new Date(payload.exp * 1000) : null;
  } catch {
    return null;
  }
}
