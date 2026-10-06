// Builds the static bus data for ALL BMTC routes from the unofficial Vonter/bmtc-gtfs feed (ODbL; scraped from the Namma
// BMTC app, so timetables can be off), for the schedule simulation in lib/busSim.ts:
//   public/data/bus/all.json    every route: shape, stop chainages + times, stop names, trip start times (loaded once by the map)
//   public/data/bus/index.json  [[routeId, "number", "Origin ⇔ Destination"], ...]  (route allow-list for the optional live API in lib/bus.ts)
// usage: node scripts/build-bus.mjs <unzipped gtfs dir>   (download: https://github.com/Vonter/bmtc-gtfs/raw/refs/heads/main/gtfs/bmtc.zip)
import fs from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';

const dir = process.argv[2];
if (!dir) throw new Error('usage: node scripts/build-bus.mjs <gtfs dir>');
const OUT = 'public/data/bus';
const THIN_M = 20; // drop shape points closer than this to the previous kept one

// minimal CSV: this feed quotes fields containing commas
const split = (l) => { const o = []; let c = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { o.push(c); c = ''; } else c += ch; } o.push(c); return o; };
async function each(file, fn) {
  let keys;
  for await (const line of readline.createInterface({ input: fs.createReadStream(path.join(dir, file)), crlfDelay: Infinity })) {
    if (!line) continue;
    const v = split(line);
    if (!keys) { keys = v; continue; }
    fn(Object.fromEntries(keys.map((k, i) => [k, v[i]])));
  }
}
const sec = (t) => { const [h, m, s] = t.split(':').map(Number); return h * 3600 + m * 60 + s; };
const R = 6371008.8, rad = Math.PI / 180;
const dist = (a, b) => R * Math.hypot((b[1] - a[1]) * rad, (b[0] - a[0]) * rad * Math.cos(a[1] * rad));
const r5 = (x) => Math.round(x * 1e5) / 1e5;
// shape as integers in 1e-5 degrees: first point absolute, then successive differences (about half the size of [lon,lat] pairs)
const delta = (line) => { const o = []; let px = 0, py = 0; for (const [x, y] of line) { const ix = Math.round(x * 1e5), iy = Math.round(y * 1e5); o.push(ix - px, iy - py); px = ix; py = iy; } return o; };

const routeInfo = {};
await each('routes.txt', (r) => { routeInfo[r.route_id] = { no: r.route_short_name, name: r.route_long_name }; });
const trips = [];
await each('trips.txt', (t) => trips.push(t));

// pass 1: stops per trip, to pick the most complete trip of each pattern as the stop pattern
const rows = new Map();
await each('stop_times.txt', (s) => rows.set(s.trip_id, (rows.get(s.trip_id) ?? 0) + 1));

// per route+direction: the most used shape, its fullest trip, and every trip on that shape (they all run the same pattern)
const groups = {};
for (const t of trips) if (rows.has(t.trip_id)) ((groups[t.route_id] ??= {})[t.direction_id] ??= []).push(t);
const pick = {}, shapeIds = new Set(), repTrips = new Set();
for (const [rid, dirs] of Object.entries(groups)) for (const [d, ts] of Object.entries(dirs)) {
  const n = {};
  for (const t of ts) n[t.shape_id] = (n[t.shape_id] ?? 0) + 1;
  const shape = Object.entries(n).sort((a, b) => b[1] - a[1])[0][0];
  const same = ts.filter((t) => t.shape_id === shape);
  const rep = same.sort((a, b) => rows.get(b.trip_id) - rows.get(a.trip_id))[0];
  pick[rid + '|' + d] = { rid, d: +d, shape, rep, same };
  shapeIds.add(shape); repTrips.add(rep.trip_id);
}

// pass 2: the stop times of the representative trips, and the first departure of every trip
const times = {}, first = new Map();
const stopIds = new Set();
await each('stop_times.txt', (s) => {
  const seq = +s.stop_sequence, f = first.get(s.trip_id);
  if (!f || seq < f[0]) first.set(s.trip_id, [seq, sec(s.departure_time)]);
  if (repTrips.has(s.trip_id)) { (times[s.trip_id] ??= []).push({ stop: s.stop_id, seq, a: sec(s.arrival_time), d: sec(s.departure_time) }); stopIds.add(s.stop_id); }
});
for (const k in times) times[k].sort((x, y) => x.seq - y.seq);

const shapes = {};
await each('shapes.txt', (p) => { if (shapeIds.has(p.shape_id)) (shapes[p.shape_id] ??= []).push([+p.shape_pt_sequence, +p.shape_pt_lon, +p.shape_pt_lat]); });
const stops = {};
await each('stops.txt', (s) => { if (stopIds.has(s.stop_id)) stops[s.stop_id] = { n: s.stop_name, lon: +s.stop_lon, lat: +s.stop_lat }; });

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const index = [], all = [];
let skipped = 0, nonMono = 0;
for (const rid of Object.keys(groups)) {
  const dirs = [];
  for (const d of Object.keys(groups[rid]).map(Number).sort()) {
    const { shape, rep, same } = pick[rid + '|' + d];
    const tt = times[rep.trip_id], raw = shapes[shape];
    if (!tt?.length || !raw || raw.length < 2 || tt.some((s) => !stops[s.stop])) { skipped++; continue; }
    raw.sort((a, b) => a[0] - b[0]);
    const pts = raw.map(([, x, y]) => [r5(x), r5(y)]);
    const line = [pts[0]];
    for (const p of pts.slice(1, -1)) if (dist(line.at(-1), p) >= THIN_M) line.push(p);
    line.push(pts.at(-1));
    const cum = line.reduce((c, p, i) => (c.push(i ? c[i - 1] + dist(line[i - 1], p) : 0), c), []);
    // chainage of each stop: nearest shape vertex at or after the previous stop's (stops come in order along the route)
    let from = 0, mono = true;
    const t0 = tt[0].d;
    const st = tt.map((s) => {
      const p = stops[s.stop]; let best = from, bd = Infinity;
      for (let i = from; i < line.length; i++) { const dd = dist(line[i], [p.lon, p.lat]); if (dd < bd) { bd = dd; best = i; } }
      if (best < from) mono = false;
      from = best;
      return [p.n, r5(p.lon), r5(p.lat), Math.round(cum[best]), s.a - t0, s.d - t0]; // name, lon, lat, chainage m, arrive s, depart s
    });
    if (!mono) nonMono++;
    const starts = [...new Set(same.map((t) => first.get(t.trip_id)?.[1]).filter((x) => x !== undefined))].sort((a, b) => a - b);
    dirs.push([rep.trip_headsign, delta(line), st.flatMap((x) => [x[3], x[4], x[5]]), st.map((x) => x[0]), starts]); // head, shape, [chainage m, arrive s, depart s]*, stop names, trip start times
  }
  if (!dirs.length) continue;
  all.push([+rid, routeInfo[rid].no, routeInfo[rid].name, dirs]);
  index.push([+rid, routeInfo[rid].no, routeInfo[rid].name]);
}
const byNo = (a, b) => a[1].localeCompare(b[1], 'en', { numeric: true });
index.sort(byNo); all.sort(byNo);
fs.writeFileSync(path.join(OUT, 'all.json'), JSON.stringify(all));
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index));
console.log(`routes ${index.length}, skipped directions ${skipped}, non-monotonic ${nonMono}; all.json ${(fs.statSync(path.join(OUT, 'all.json')).size / 1048576).toFixed(1)} MB, index ${(fs.statSync(path.join(OUT, 'index.json')).size / 1024) | 0} KB`);
