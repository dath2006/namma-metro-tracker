// Schedule-driven bus positions for routes with no live GPS: pure function of (static GTFS data, time), like lib/engine.ts.
// Straight interpolation between stop times; no traffic model, so treat the result as "where the timetable says it should be".
export type BusStop = { n: string; lon: number; lat: number; c: number; a: number; d: number }; // c = chainage (m); a/d = arrive/depart, s after trip start
export type BusDir = { head: string; shape: [number, number][]; stops: BusStop[]; starts: number[]; cum?: number[] };
export type BusRoute = { no: string; name: string; dirs: BusDir[] };
export type SimBus = { id: string; route: string; lon: number; lat: number; heading: number; speed: number; next: string; head: string };
/** One bus as drawn: live (GPS) or scheduled (sim). speed in m/s. */
export type BusView = { id: string; route: string; reg: string; ac: boolean; sim: boolean; lon: number; lat: number; heading: number; speed: number; ts: number; next: string; head: string };

const rad = Math.PI / 180, R = 6371008.8;
const hav = (a: number[], b: number[]) => R * Math.hypot((b[1] - a[1]) * rad, (b[0] - a[0]) * rad * Math.cos(a[1] * rad));

/** Adds cumulative shape distances (m) in place. */
export function prepare(routes: Record<string, BusRoute>) {
  for (const r of Object.values(routes)) for (const d of r.dirs) d.cum = d.shape.reduce<number[]>((c, p, i) => (c.push(i ? c[i - 1] + hav(d.shape[i - 1], p) : 0), c), []);
  return routes;
}

function posAt(d: BusDir, s: number): [number, number, number] {
  const c = d.cum!;
  let lo = 0, hi = c.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= s) lo = m; else hi = m; }
  const t = Math.min(1, Math.max(0, (s - c[lo]) / (c[hi] - c[lo] || 1)));
  const [x1, y1] = d.shape[lo], [x2, y2] = d.shape[hi];
  return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, (Math.atan2((x2 - x1) * Math.cos(y1 * rad), y2 - y1) / rad + 360) % 360];
}

/** Buses the timetable says are running at epoch ms `now` on the given routes (IST service day; trips may run past midnight). */
export function simBuses(routes: BusRoute[], now: number): SimBus[] {
  const ist = new Date(now + 5.5 * 3600e3);
  const sec = ist.getUTCHours() * 3600 + ist.getUTCMinutes() * 60 + ist.getUTCSeconds() + ist.getUTCMilliseconds() / 1000;
  const out: SimBus[] = [];
  for (const r of routes) r.dirs.forEach((d, di) => {
    const last = d.stops.length - 1;
    for (const back of [0, 1]) for (const s0 of d.starts) {
      const e = sec + back * 86400 - s0;
      if (e < 0) break; // starts are sorted
      if (e > d.stops[last].a) continue;
      let k = 0;
      while (k < last && d.stops[k + 1].d <= e) k++;
      const a = d.stops[k], b = d.stops[Math.min(k + 1, last)];
      const moving = k < last && e >= a.d && e < b.a;
      const c = moving ? a.c + ((e - a.d) / (b.a - a.d || 1)) * (b.c - a.c) : (e >= b.a && k < last ? b.c : a.c);
      const [lon, lat, heading] = posAt(d, c);
      out.push({ id: `sim-${r.no}-${di}-${s0}-${back}`, route: r.no, lon, lat, heading, speed: moving ? (b.c - a.c) / (b.a - a.d || 1) : 0, next: (moving || k === 0 ? b : a).n, head: d.head });
    }
  });
  return out;
}

/** Next stop ahead of a bus at (lon, lat) heading `heading`: snaps to the nearest shape segment that runs the same way. */
export function nextStop(r: BusRoute, lon: number, lat: number, heading: number): { name: string; dist: number; head: string } | null {
  let best: { d: BusDir; i: number; dist: number } | null = null;
  for (const d of r.dirs) for (let i = 0; i < d.shape.length - 1; i++) {
    const p = d.shape[i], dist = hav(p, [lon, lat]);
    if (best && dist >= best.dist) continue;
    const q = d.shape[i + 1], bearing = (Math.atan2((q[0] - p[0]) * Math.cos(p[1] * rad), q[1] - p[1]) / rad + 360) % 360;
    if (Math.abs(((bearing - heading + 540) % 360) - 180) < 75) best = { d, i, dist };
  }
  if (!best) return null;
  const c = best.d.cum![best.i], s = best.d.stops.find((x) => x.c > c);
  return s ? { name: s.n, dist: s.c - c, head: best.d.head } : null;
}
