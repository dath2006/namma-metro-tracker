import { getBuses } from '@/lib/bus';

export async function GET() {
  try {
    return Response.json(await getBuses(), { headers: { 'cache-control': 'public, s-maxage=10, stale-while-revalidate=30' } });
  } catch {
    return Response.json({ error: 'BMTC live service is temporarily unavailable' }, { status: 502, headers: { 'cache-control': 'no-store' } });
  }
}
