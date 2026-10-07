import crypto from 'node:crypto';
import { config } from '../config.js';

const KEY_LENGTH = 64;
// Lower cost in tests keeps the suite fast; production uses the recommended interactive-login cost.
const COST = config.isTest ? 1024 : 16384;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const MAX_MEM = 64 * 1024 * 1024;

function scrypt(secret: string, salt: Buffer, keyLength: number, n: number, r: number, p: number) {
  return new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(secret.normalize('NFKC'), salt, keyLength, { N: n, r, p, maxmem: MAX_MEM }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

/** Hashes a password or PIN with a random salt. Format: scrypt$N$r$p$salt$hash (base64). */
export async function hashSecret(secret: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(secret, salt, KEY_LENGTH, COST, BLOCK_SIZE, PARALLELISM);
  return ['scrypt', COST, BLOCK_SIZE, PARALLELISM, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifySecret(secret: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) {
    // Spend comparable time so a missing account cannot be detected through response timing.
    await scrypt(secret, crypto.randomBytes(16), KEY_LENGTH, COST, BLOCK_SIZE, PARALLELISM);
    return false;
  }
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, salt, hash] = parts as [string, string, string, string, string, string];
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(secret, Buffer.from(salt, 'base64'), expected.length, Number(n), Number(r), Number(p));
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/** Human-friendly reference such as DEP-20261007-7F3K9Q. */
export function referenceCode(prefix: string, date: string): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(6);
  let suffix = '';
  for (const byte of bytes) suffix += alphabet[byte % alphabet.length];
  return `${prefix}-${date.replaceAll('-', '')}-${suffix}`;
}
