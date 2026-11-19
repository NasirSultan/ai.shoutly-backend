// Generates the ES256 private key for Bluesky OAuth (BLUESKY_PRIVATE_JWK).
// Run once:  node scripts/generate-bluesky-key.js
// Paste the printed line into .env (and your host's env settings). Keep it
// secret and keep it stable: Bluesky sessions are bound to this key.
const { generateKeyPairSync } = require('crypto');

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = privateKey.export({ format: 'jwk' });
const kid = `shoutly-bsky-${new Date().toISOString().slice(0, 10)}`;
console.log(`BLUESKY_PRIVATE_JWK='${JSON.stringify({ ...jwk, kid, alg: 'ES256', key_ops: ['sign'] })}'`);
