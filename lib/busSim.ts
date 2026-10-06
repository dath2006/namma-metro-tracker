// Schedule-driven bus positions for every BMTC route: pure function of (static GTFS data, time), like lib/engine.ts.
// Straight interpolation between stop times; no traffic model, so treat the result as "where the timetable says it should be".
export type BusStop = { n: string; c: number; a: number; d: number }; // c = chainage (m); a/d = arrive/depart, s after trip start
export type BusDir = { head: string; lon: Float64Array; lat: Float64Array; cum: Float64Array; stops: BusStop[]; starts: number[] };
export type BusRoute = { id: number; no: string; name: string; dirs: BusDir[] };

/** On-disk form of /data/bus/all.json (see scripts/build-bus.mjs): shape as 1e-5° integer deltas, stop times flat. */
export type RawBusRoute = [id: number, no: string, name: string, dirs: [head: string, shape: number[], stops: number[], names: string[], starts: number[]][]];

export type SimBus = { id: string; route: string; rid: number; lon: number; lat: number; heading: number; speed: number; next: string; head: string; dist: number; eta: number };
/** One bus as drawn. speed in m/s, dist in m and eta in s to the next stop. */
export type BusView = { id: string; route: string; rid: number; reg: string; ac: boolean; sim: boolean; lon: number; lat: number; heading: number; speed: number; ts: number; next: string; head: string; dist?: number; eta?: number };

const rad = Math.PI / 180, R = 6371008.8;

export function parseRoutes(raw: RawBusRoute[]): BusRoute[] {
  return raw.map(([id, no, name, dirs]) => ({
    id, no, name,
    dirs: dirs.map(([head, shape, st, names, starts]) => {
      const n = shape.length >> 1, lon = new Float64Array(n), lat = new Float64Array(n), cum = new Float64Array(n);
      let x = 0, y = 0;
      for (let i = 0; i < n; i++) {
        x += shape[2 * i]; y += shape[2 * i + 1];
        lon[i] = x / 1e5; lat[i] = y / 1e5;
        if (i) cum[i] = cum[i - 1] + R * Math.hypot((lat[i] - lat[i - 1]) * rad, (lon[i] - lon[i - 1]) * rad * Math.cos(lat[i - 1] * rad));
      }
      return { head, lon, lat, cum, starts, stops: names.map((n, i) => ({ n, c: st[3 * i], a: st[3 * i + 1], d: st[3 * i + 2] })) };
    }),
  }));
}

function posAt(d: BusDir, s: number): [number, number, number] {
  const c = d.cum;
  let lo = 0, hi = c.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= s) lo = m; else hi = m; }
  const t = Math.min(1, Math.max(0, (s - c[lo]) / (c[hi] - c[lo] || 1)));
  const x1 = d.lon[lo], y1 = d.lat[lo], x2 = d.lon[hi], y2 = d.lat[hi];
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
      const ahead = moving || k === 0 ? b : a;
      out.push({ id: `sim-${r.id}-${di}-${s0}-${back}`, route: r.no, rid: r.id, lon, lat, heading, speed: moving ? (b.c - a.c) / (b.a - a.d || 1) : 0, next: ahead.n, head: d.head, dist: moving ? b.c - c : 0, eta: moving ? b.a - e : 0 });
    }
  });
  return out;
}

/** [west, south, east, north] of every direction of a route. */
export function routeBounds(r: BusRoute): [number, number, number, number] {
  const b: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const d of r.dirs) for (let i = 0; i < d.lon.length; i++) { b[0] = Math.min(b[0], d.lon[i]); b[1] = Math.min(b[1], d.lat[i]); b[2] = Math.max(b[2], d.lon[i]); b[3] = Math.max(b[3], d.lat[i]); }
  return b;
}

/** Stops of a route, placed on its line by chainage (the feed's own stop coordinates are not kept: it halves the download). */
export function stopPoints(r: BusRoute): { n: string; lon: number; lat: number }[] {
  const seen = new Set<string>();
  return r.dirs.flatMap((d) => d.stops.map((s) => { const [lon, lat] = posAt(d, s.c); return { n: s.n, lon, lat }; })).filter((p) => !seen.has(p.n + p.lon.toFixed(4)) && seen.add(p.n + p.lon.toFixed(4)));
}
