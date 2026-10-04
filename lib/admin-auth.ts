import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';

export const COOKIE = 'admin';
const TTL_MS = 8 * 3600e3;

// ADMIN_PASSWORD and ADMIN_SECRET come from .env.local. With no password configured, nobody can log in.
const secret = () => process.env.ADMIN_SECRET ?? '';
const sign = (v: string) => createHmac('sha256', secret()).update(v).digest('hex');
const digest = (s: string) => createHash('sha256').update(s).digest();

export function checkPassword(p: string) {
  const want = process.env.ADMIN_PASSWORD;
  if (!want || !secret()) return false;
  return timingSafeEqual(digest(p), digest(want)); // compare hashes so length does not leak
}

export const makeToken = () => {
  const exp = String(Date.now() + TTL_MS);
  return `${exp}.${sign(exp)}`;
};

function verify(token?: string) {
  if (!token || !secret()) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const good = sign(exp);
  return sig.length === good.length && timingSafeEqual(Buffer.from(sig), Buffer.from(good));
}

export async function isAdmin() {
  return verify((await cookies()).get(COOKIE)?.value);
}

export const cookieOptions = { httpOnly: true, sameSite: 'strict' as const, secure: process.env.NODE_ENV === 'production', path: '/', maxAge: TTL_MS / 1000 };

// Failed-login throttle: 5 misses per client, then a one-minute lockout. In-memory, so it resets on restart.
const misses = new Map<string, { n: number; until: number }>();
export function throttled(key: string) {
  const m = misses.get(key);
  return !!m && m.until > Date.now();
}
export function recordMiss(key: string) {
  const m = misses.get(key) ?? { n: 0, until: 0 };
  m.n += 1;
  if (m.n >= 5) { m.until = Date.now() + 60_000; m.n = 0; }
  misses.set(key, m);
}
export const clearMisses = (key: string) => misses.delete(key);
