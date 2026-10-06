import { getBuses, getRouteBuses, RateLimited, UnknownRoute } from '@/lib/bus';

// GET /api/buses            -> the always-live popular routes
// GET /api/buses?route=<id> -> one route (any id from /data/bus/index.json)
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get('route');
  const id = q === null ? null : /^\d{1,6}$/.test(q) ? +q : NaN;
  if (Number.isNaN(id)) return Response.json({ error: 'bad route' }, { status: 400 });
  try {
    return Response.json(id === null ? await getBuses() : await getRouteBuses(id), { headers: { 'cache-control': 'public, s-maxage=10, stale-while-revalidate=30' } });
  } catch (e) {
    const [status, error] = e instanceof UnknownRoute ? [404, 'unknown route'] : e instanceof RateLimited ? [429, 'too many route lookups, retry shortly'] : [502, 'BMTC live service is temporarily unavailable'];
    return Response.json({ error }, { status, headers: { 'cache-control': 'no-store' } });
  }
}
