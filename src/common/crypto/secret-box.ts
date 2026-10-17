import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// Small AES-256-GCM helper for secrets stored in the database (OAuth
// sessions, tokens). Encryption is on when TOKEN_ENCRYPTION_KEY holds a
// 32-byte key (base64 or hex). Values written before the key was set are
// stored as plain text and are still readable: decryptSecret() only
// decrypts values carrying the "enc:v1:" prefix.

const PREFIX = 'enc:v1:';

function key(): Buffer | null {
  const raw = process.env.TOKEN_ENCRYPTION_KEY?.trim();
  if (!raw) return null;
  const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes (openssl rand -base64 32).');
  }
  return buf;
}

export function encryptSecret(plain: string): string {
  const k = key();
  if (!k) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', k, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${data.toString('base64')}`;
}

export function decryptSecret(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored;
  const k = key();
  if (!k) throw new Error('TOKEN_ENCRYPTION_KEY is required to read encrypted secrets.');
  const [iv, tag, data] = stored.slice(PREFIX.length).split(':');
  const decipher = createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}
