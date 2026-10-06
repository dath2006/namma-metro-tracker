// Live BMTC bus positions from the unofficial Namma BMTC mobile API (no key, undocumented; may change or block).
// One upstream call per route returns every bus on it. There is no "all buses" call, so the ~4.4k routes cannot all be polled:
// a small set of popular routes is always live (PILOT) and any other route is fetched only while someone is looking at it.
// Server-side only.
import pilot from '../data/bus-pilot.json';
import index from '../public/data/bus/index.json';

export type Bus = { id: number; reg: string; route: string; rid: number; lat: number; lon: number; heading: number; ac: boolean; ts: number };

// Always-live routes: BMTC `routeparentid` -> public number. Edit data/bus-pilot.json (any id from public/data/bus/index.json).
export const PILOT = pilot as Record<string, string>;
const KNOWN = new Map((index as [number, string, string][]).map(([id, no]) => [id, no])); // only routes we have static data for can be requested
for (const [id, no] of Object.entries(PILOT)) KNOWN.set(+id, no); // ...plus the always-live ones (some have no timetable in the feed)

const UPSTREAM = 'https://bmtcmobileapi.karnataka.gov.in/WebAPI/';
const TTL = 10_000; // a route's result is shared by every viewer for this long
const MAX_AGE = 15 * 60_000; // drop buses whose GPS has been silent this long (parked / dead unit)
const MAX_CONCURRENT = 8; // simultaneous upstream calls
const BUDGET = 40; // fresh upstream calls allowed per TTL window per server instance; protects BMTC from route-browsing floods
const MAX_CACHED = 500;

export class RateLimited extends Error {}
export class UnknownRoute extends Error {}

// "06-10-2026 13:53:49" IST wall clock -> epoch ms
const istMs = (s: string) => {
  const m = s.match(/^(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2}):(\d{2})$/);
  return m ? Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +m[6]) - 5.5 * 3600e3 : NaN;
};

type Raw = { vehicleid: number; vehiclenumber: string; servicetypeid: number; centerlat: number; centerlong: number; heading: number; lastrefreshon: string };

let active = 0;
const waiters: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((r) => waiters.push(r));
  active++;
  try { return await fn(); } finally { active--; waiters.shift()?.(); }
}
let win = { at: 0, n: 0 };
const spend = (now: number) => {
  if (now - win.at > TTL) win = { at: now, n: 0 };
  return ++win.n <= BUDGET;
};

async function upstream(rid: number, now: number): Promise<Bus[]> {
  const r = await slot(() => fetch(`${UPSTREAM}SearchByRouteDetails_v4`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', lan: 'en', deviceType: 'WEB', authToken: 'N/A', 'User-Agent': 'NammaMetroTracker/0.1 (bus tracker)' }, // upstream 403s anonymous/curl UAs
    body: JSON.stringify({ routeid: rid, servicetypeid: 0 }),
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  }));
  if (!r.ok) throw new Error(`BMTC ${r.status}`);
  const j = (await r.json()) as Record<'up' | 'down', { mapData?: Raw[] } | undefined>;
  const no = KNOWN.get(rid)!;
  return (['up', 'down'] as const).flatMap((d) => j[d]?.mapData ?? []).flatMap((v) => {
    const ts = istMs(v.lastrefreshon ?? '');
    const ok = Number.isFinite(ts) && now - ts < MAX_AGE && v.centerlat > 8 && v.centerlat < 18 && v.centerlong > 70 && v.centerlong < 85;
    return ok ? [{ id: v.vehicleid, reg: v.vehiclenumber, route: no, rid, lat: v.centerlat, lon: v.centerlong, heading: v.heading ?? 0, ac: v.servicetypeid === 73, ts }] : [];
  });
}

const cache = new Map<number, { at: number; p: Promise<Bus[]> }>();
// ponytail: per-instance memory cache and budget; serverless instances each keep their own. Move to a shared store (KV/Redis) if upstream load matters.
function routeBuses(rid: number): Promise<Bus[]> {
  if (!KNOWN.has(rid)) throw new UnknownRoute(String(rid));
  const now = Date.now(), hit = cache.get(rid);
  if (hit && now - hit.at < TTL) return hit.p;
  if (!spend(now)) { if (hit) return hit.p; throw new RateLimited(); } // over budget: serve what we have, even if old
  const p = upstream(rid, now);
  cache.delete(rid); // re-insert so Map order is oldest-first
  cache.set(rid, { at: now, p });
  if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
  p.catch(() => { if (cache.get(rid)?.p === p) cache.delete(rid); }); // don't cache failures
  return p;
}

const dedupe = (all: Bus[]) => [...new Map(all.map((b) => [b.id, b])).values()]; // a bus can show up on two routes' feeds

/** The always-live popular routes. */
export async function getBuses(): Promise<Bus[]> {
  const rs = await Promise.allSettled(Object.keys(PILOT).map((id) => routeBuses(+id)));
  if (rs.every((x) => x.status === 'rejected')) throw new Error('BMTC upstream unavailable');
  return dedupe(rs.flatMap((x) => (x.status === 'fulfilled' ? x.value : [])));
}

/** Any one route, on demand. */
export const getRouteBuses = (rid: number) => routeBuses(rid);
