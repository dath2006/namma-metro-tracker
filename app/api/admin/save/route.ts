import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { NextRequest } from 'next/server';
import { isAdmin } from '@/lib/admin-auth';

const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 500;
const pair = (v: unknown) => Array.isArray(v) && v.length === 2 && num(v[0]) && num(v[1]);

// Validate the shape so a bad client cannot write junk (or something huge) into the file the whole site loads.
function valid(o: unknown): boolean {
  if (typeof o !== 'object' || o === null) return false;
  const { trackOffset, lines } = o as { trackOffset?: unknown; lines?: unknown };
  if (trackOffset !== undefined && !(typeof trackOffset === 'number' && trackOffset >= 0 && trackOffset <= 10)) return false;
  if (lines === undefined) return true;
  if (typeof lines !== 'object' || lines === null) return false;
  return Object.values(lines).every((l) => {
    const { shift, offsets } = l as { shift?: unknown; offsets?: Record<string, unknown> };
    return (shift === undefined || pair(shift)) && (offsets === undefined || (typeof offsets === 'object' && offsets !== null && Object.values(offsets).every(pair)));
  });
}

export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return Response.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  const body: unknown = await req.json().catch(() => null);
  if (!valid(body)) return Response.json({ ok: false, error: 'Invalid data.' }, { status: 400 });
  const dir = path.join(process.cwd(), 'data');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'overrides.json'), JSON.stringify(body));
  return Response.json({ ok: true });
}
