import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { COOKIE, checkPassword, clearMisses, cookieOptions, isAdmin, makeToken, recordMiss, throttled } from '@/lib/admin-auth';

export async function GET() {
  return Response.json({ ok: await isAdmin() });
}

export async function POST(req: NextRequest) {
  const key = req.headers.get('x-forwarded-for') ?? 'local';
  if (throttled(key)) return Response.json({ ok: false, error: 'Too many attempts. Try again in a minute.' }, { status: 429 });
  const { password } = (await req.json().catch(() => ({}))) as { password?: unknown };
  if (typeof password !== 'string' || !checkPassword(password)) {
    recordMiss(key);
    return Response.json({ ok: false, error: 'Wrong password.' }, { status: 401 });
  }
  clearMisses(key);
  (await cookies()).set(COOKIE, makeToken(), cookieOptions);
  return Response.json({ ok: true });
}

export async function DELETE() {
  (await cookies()).delete(COOKIE);
  return Response.json({ ok: true });
}
