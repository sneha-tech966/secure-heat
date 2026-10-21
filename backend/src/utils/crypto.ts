import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const sha256Hex = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

/** Constant-time comparison of two hex strings of equal expected length. */
export function safeEqualHex(a: string, b: string): boolean {
  if (!/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b) || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

/* ---------- sensor credentials ---------- */
export const generateApiKey = (): string => 'sh_' + randomBytes(32).toString('base64url');
export const generateSecret = (): string => randomBytes(32).toString('hex');

/** API keys are 256-bit random values, so a fast hash is appropriate (bcrypt is for low-entropy passwords and
 *  would add ~100ms to every telemetry request). Only the hash is stored. */
export const hashApiKey = (apiKey: string): string => sha256Hex(apiKey);
export const verifyApiKey = (apiKey: string, storedHash: string): boolean => safeEqualHex(hashApiKey(apiKey), storedHash);

/** HMAC secrets must be recoverable, so they are encrypted at rest (AES-256-GCM), not hashed. */
export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join(':');
}
export function decryptSecret(stored: string, key: Buffer): string {
  const [v, iv, tag, ct] = stored.split(':');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('unsupported secret format');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}

/* ---------- request signing ---------- */
/** Canonical string signed by the sensor. Cross-language safe: it binds the metadata to the SHA-256 of the exact
 *  raw request bytes, so no JSON re-serialisation / float-formatting differences can break verification.
 *  Format:  v1\n<sensorId>\n<timestamp>\n<sequenceNumber>\n<sha256hex(rawBody)>  */
export function canonicalString(sensorId: string, timestamp: string, sequenceNumber: number, rawBody: Buffer | string): string {
  return ['v1', sensorId, timestamp, String(sequenceNumber), sha256Hex(rawBody)].join('\n');
}
export const signCanonical = (secret: string, canonical: string): string => createHmac('sha256', secret).update(canonical).digest('hex');
export const verifySignature = (secret: string, canonical: string, signatureHex: string): boolean =>
  safeEqualHex(signCanonical(secret, canonical), signatureHex);
