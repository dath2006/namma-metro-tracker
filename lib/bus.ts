import pilot from '../data/bus-pilot.json';
// Live BMTC bus positions from the unofficial Namma BMTC mobile API (no key, undocumented; may change or block).
// One upstream call per route returns every bus on it, so a pilot list keeps this cheap. Server-side only.
export type Bus = { id: number; reg: string; route: string; lat: number; lon: number; heading: number; ac: boolean; ts: number };

// Pilot routes: BMTC `routeparentid` -> public number. Edit data/bus-pilot.json then `node scripts/build-bus.mjs <gtfs dir>`; resolve ids via SearchRoute_v2 {routetext}.
export const PILOT = pilot as Record<string, string>;

const UPSTREAM = 'https://bmtcmobileapi.karnataka.gov.in/WebAPI/';
const TTL = 10_000; // s-maxage-style shared cache so N viewers cost one upstream round per TTL
const MAX_AGE = 15 * 60_000; // drop buses whose GPS has been silent this long (parked / dead unit)

// "06-10-2026 13:53:49" IST wall clock -> epoch ms
const istMs = (s: string) => {
  const m = s.match(/^(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2}):(\d{2})$/);
  return m ? Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +m[6]) - 5.5 * 3600e3 : NaN;
};

type Raw = { vehicleid: number; vehiclenumber: string; servicetypeid: number; centerlat: number; centerlong: number; heading: number; lastrefreshon: string };

async function route(id: number, number: string, now: number): Promise<Bus[]> {
  const r = await fetch(`${UPSTREAM}SearchByRouteDetails_v4`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', lan: 'en', deviceType: 'WEB', authToken: 'N/A', 'User-Agent': 'NammaMetroTracker/0.1 (bus pilot)' }, // upstream 403s anonymous/curl UAs
    body: JSON.stringify({ routeid: id, servicetypeid: 0 }),
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`BMTC ${r.status}`);
  const j = (await r.json()) as Record<'up' | 'down', { mapData?: Raw[] } | undefined>;
  return (['up', 'down'] as const).flatMap((d) => j[d]?.mapData ?? []).flatMap((v) => {
    const ts = istMs(v.lastrefreshon ?? '');
    const ok = Number.isFinite(ts) && now - ts < MAX_AGE && v.centerlat > 8 && v.centerlat < 18 && v.centerlong > 70 && v.centerlong < 85;
    return ok ? [{ id: v.vehicleid, reg: v.vehiclenumber, route: number, lat: v.centerlat, lon: v.centerlong, heading: v.heading ?? 0, ac: v.servicetypeid === 73, ts }] : [];
  });
}

let cache: { at: number; p: Promise<Bus[]> } | null = null;
// ponytail: per-instance memory cache; serverless instances each keep their own. Move to a shared cache (KV/Redis) if upstream load matters.
export function getBuses(): Promise<Bus[]> {
  const now = Date.now();
  if (cache && now - cache.at < TTL) return cache.p;
  const p = Promise.allSettled(Object.entries(PILOT).map(([id, n]) => route(+id, n, now))).then((rs) => {
    if (rs.every((x) => x.status === 'rejected')) throw new Error('BMTC upstream unavailable');
    return [...new Map(rs.flatMap((x) => (x.status === 'fulfilled' ? x.value : [])).map((b) => [b.id, b])).values()]; // a bus can appear in both directions
  });
  cache = { at: now, p };
  p.catch(() => { if (cache?.p === p) cache = null; }); // don't cache failures
  return p;
}
