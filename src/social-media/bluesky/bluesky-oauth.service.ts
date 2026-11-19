import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'crypto';
import type * as OAuthNode from '@atproto/oauth-client-node';
import { prisma } from '../../lib/prisma';
import { RedisService } from '../../common/redis/redis.service';
import { decryptSecret, encryptSecret } from '../../common/crypto/secret-box';

// AT Protocol OAuth for Bluesky (DPoP + PKCE + PAR), via the official
// @atproto/oauth-client-node library.
//
// Production (confidential client): BLUESKY_PRIVATE_JWK holds an ES256 private
// key. The public client metadata is served from BLUESKY_CLIENT_ID and the
// public key from BLUESKY_JWKS_URI (see BlueskyController). Sessions can stay
// alive indefinitely; each refresh token lasts up to 180 days.
//
// Local development: with no private key and a localhost FRONTEND_URL, a
// loopback client (client_id http://localhost) is used — no key or public URL
// needed, but sessions are capped at ~2 weeks.
//
// The @atproto packages are ESM-only (Node >= 22), so they are loaded with a
// dynamic import() at startup instead of a static import.

const STATE_TTL_SECONDS = 60 * 60;
const LINK_TTL_SECONDS = 10 * 60;
const LOCK_TTL_MS = 45_000;

type OAuthModule = typeof OAuthNode;
export type BlueskyOAuthSession = OAuthNode.OAuthSession;

@Injectable()
export class BlueskyOAuthService implements OnModuleInit {
  private readonly logger = new Logger(BlueskyOAuthService.name);
  private client: OAuthNode.NodeOAuthClient | null = null;
  private lib: OAuthModule | null = null;
  private initError: string | null = null;

  constructor(private readonly redisService: RedisService) {}

  async onModuleInit() {
    try {
      await this.init();
    } catch (error) {
      this.initError = error instanceof Error ? error.message : String(error);
      this.logger.error(`Bluesky OAuth is disabled: ${this.initError}`);
    }
  }

  get enabled() {
    return !!this.client;
  }

  get disabledReason() {
    return this.initError || 'Bluesky OAuth is not configured on the server.';
  }

  get scope() {
    return process.env.BLUESKY_SCOPE?.trim() || 'atproto transition:generic';
  }

  clientMetadata() {
    if (!this.client) throw new NotFoundException('Bluesky OAuth is not configured.');
    return this.client.clientMetadata;
  }

  jwks() {
    if (!this.client) throw new NotFoundException('Bluesky OAuth is not configured.');
    return this.client.jwks;
  }

  // Returns the URL to send the browser to. `userId` is remembered against a
  // random nonce that comes back as `state` in the callback.
  async authorizeUrl(userId: string, handle: string): Promise<string> {
    const client = this.requireClient();
    const nonce = randomBytes(16).toString('base64url');
    const linkKey = `bsky:oauth:link:${nonce}`;
    await this.redis().set(linkKey, userId, { EX: LINK_TTL_SECONDS });
    try {
      const url = await client.authorize(handle, { scope: this.scope, state: nonce });
      return url.toString();
    } catch (error) {
      await this.redis().del(linkKey);
      throw error;
    }
  }

  // Completes the redirect. Returns the new session and the Shoutly user it
  // belongs to.
  async callback(params: URLSearchParams): Promise<{ session: BlueskyOAuthSession; userId: string }> {
    const client = this.requireClient();
    const { session, state } = await client.callback(params);
    const key = `bsky:oauth:link:${state ?? ''}`;
    const userId = state ? await this.redis().get(key) : null;
    if (state) await this.redis().del(key);
    if (!userId) {
      await client.revoke(session.did).catch(() => undefined);
      throw new Error('link_expired');
    }
    return { session, userId };
  }

  // Loads a stored session and refreshes its tokens when needed. Throws when
  // the session is gone, revoked or can no longer be refreshed.
  async restore(did: string): Promise<BlueskyOAuthSession> {
    return this.requireClient().restore(did, 'auto');
  }

  async revoke(did: string): Promise<void> {
    await this.requireClient().revoke(did);
  }

  // True when the error means the user has to connect again (as opposed to a
  // network blip worth retrying).
  isAuthError(error: unknown): boolean {
    const lib = this.lib;
    if (!lib) return false;
    if (
      error instanceof lib.TokenRefreshError ||
      error instanceof lib.TokenRevokedError ||
      error instanceof lib.TokenInvalidError
    ) {
      return true;
    }
    const message = error instanceof Error ? error.message : String(error);
    return /session .*(not found|does not exist|deleted)|invalid_grant|revoked/i.test(message);
  }

  private requireClient(): OAuthNode.NodeOAuthClient {
    if (!this.client) throw new Error(this.disabledReason);
    return this.client;
  }

  private redis() {
    return this.redisService.getClient();
  }

  private async init() {
    const lib = (await import('@atproto/oauth-client-node')) as OAuthModule;
    this.lib = lib;

    const privateJwk = process.env.BLUESKY_PRIVATE_JWK?.trim();
    const front = process.env.FRONTEND_URL || '';
    const handleResolver = process.env.BLUESKY_HANDLE_RESOLVER?.trim() || undefined;

    const common = {
      stateStore: this.stateStore(),
      sessionStore: this.sessionStore(),
      requestLock: this.requestLock(),
      ...(handleResolver ? { handleResolver } : {}),
    };

    if (privateJwk) {
      const base = (process.env.BACKEND_PUBLIC_URL || 'https://backend.shoutlyai.com').replace(/\/$/, '');
      const site = (front && !front.includes('localhost') ? front : 'https://shoutlyai.com').replace(/\/$/, '');
      const clientId = process.env.BLUESKY_CLIENT_ID?.trim() || `${base}/api/bluesky/client-metadata.json`;
      const redirectUri = process.env.BLUESKY_REDIRECT_URI?.trim() || `${base}/api/bluesky/callback`;
      const jwksUri = process.env.BLUESKY_JWKS_URI?.trim() || `${base}/api/bluesky/jwks.json`;
      const clientUri = new URL(clientId).origin;
      const key = await lib.JoseKey.fromImportable(privateJwk, this.keyId(privateJwk));

      this.client = new lib.NodeOAuthClient({
        ...common,
        clientMetadata: {
          client_id: clientId,
          client_name: 'Shoutly AI',
          // Must share the client_id's hostname (atproto OAuth spec).
          client_uri: clientUri as `https://${string}`,
          logo_uri: `${site}/logo2.png` as `https://${string}`,
          tos_uri: `${site}/terms-and-conditions` as `https://${string}`,
          policy_uri: `${site}/privacy-policy` as `https://${string}`,
          redirect_uris: [redirectUri as `https://${string}`],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          scope: this.scope,
          application_type: 'web',
          token_endpoint_auth_method: 'private_key_jwt',
          token_endpoint_auth_signing_alg: 'ES256',
          dpop_bound_access_tokens: true,
          jwks_uri: jwksUri as `https://${string}`,
        },
        keyset: [key],
      });
      this.logger.log(`Bluesky OAuth ready (confidential client ${clientId})`);
      return;
    }

    if (front.includes('localhost')) {
      const port = process.env.PORT || '4000';
      const redirectUri =
        process.env.BLUESKY_REDIRECT_URI?.trim() || `http://127.0.0.1:${port}/api/bluesky/callback`;
      this.client = new lib.NodeOAuthClient({
        ...common,
        clientMetadata: lib.buildAtprotoLoopbackClientMetadata({
          scope: this.scope as never,
          redirect_uris: [redirectUri as never],
        }),
      });
      this.logger.warn(`Bluesky OAuth running as a local loopback client (${redirectUri}). Set BLUESKY_PRIVATE_JWK for production.`);
      return;
    }

    throw new Error('BLUESKY_PRIVATE_JWK is not set.');
  }

  private keyId(privateJwk: string): string {
    try {
      const parsed = JSON.parse(privateJwk) as { kid?: string };
      return parsed.kid || 'shoutly-bsky-1';
    } catch {
      return 'shoutly-bsky-1';
    }
  }

  // Short-lived authorization state (PKCE verifier, DPoP key) — Redis, 1 h.
  private stateStore(): OAuthNode.NodeSavedStateStore {
    const prefix = 'bsky:oauth:state:';
    return {
      set: async (key, value) => {
        await this.redis().set(prefix + key, encryptSecret(JSON.stringify(value)), { EX: STATE_TTL_SECONDS });
      },
      get: async (key) => {
        const raw = await this.redis().get(prefix + key);
        return raw ? (JSON.parse(decryptSecret(String(raw))) as OAuthNode.NodeSavedState) : undefined;
      },
      del: async (key) => {
        await this.redis().del(prefix + key);
      },
    };
  }

  // Long-lived sessions (DPoP key + tokens) — Postgres, keyed by DID.
  private sessionStore(): OAuthNode.NodeSavedSessionStore {
    return {
      set: async (did, value) => {
        const data = encryptSecret(JSON.stringify(value));
        await prisma.blueskyOAuthSession.upsert({
          where: { did },
          update: { data },
          create: { did, data },
        });
      },
      get: async (did) => {
        const row = await prisma.blueskyOAuthSession.findUnique({ where: { did } });
        return row ? (JSON.parse(decryptSecret(row.data)) as OAuthNode.NodeSavedSession) : undefined;
      },
      del: async (did) => {
        await prisma.blueskyOAuthSession.deleteMany({ where: { did } });
      },
    };
  }

  // Cross-instance lock so two workers never refresh the same session at
  // once (refresh tokens rotate; a race would kill the session).
  private requestLock(): OAuthNode.RuntimeLock {
    return async <T>(name: string, fn: () => T | PromiseLike<T>): Promise<T> => {
      const key = `bsky:oauth:lock:${name}`;
      const token = randomBytes(8).toString('hex');
      const deadline = Date.now() + LOCK_TTL_MS;
      while (!(await this.redis().set(key, token, { NX: true, PX: LOCK_TTL_MS }))) {
        if (Date.now() > deadline) throw new Error('Timed out waiting for the Bluesky session lock.');
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      try {
        return await fn();
      } finally {
        if ((await this.redis().get(key)) === token) await this.redis().del(key);
      }
    };
  }
}
