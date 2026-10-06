// Builds public/data/bus.json (route shapes, stops, timetable) for the pilot routes in data/bus-pilot.json
// from the unofficial Vonter/bmtc-gtfs feed (ODbL; scraped from the Namma BMTC app, so timetables can be off).
// usage: node scripts/build-bus.mjs <unzipped gtfs dir>   (download: https://github.com/Vonter/bmtc-gtfs/raw/refs/heads/main/gtfs/bmtc.zip)
import fs from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';

const dir = process.argv[2];
if (!dir) throw new Error('usage: node scripts/build-bus.mjs <gtfs dir>');
const pilot = JSON.parse(fs.readFileSync('data/bus-pilot.json', 'utf8'));

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

const routeName = {};
await each('routes.txt', (r) => { if (pilot[r.route_id]) routeName[r.route_id] = r.route_long_name; });
const trips = []; // pilot trips only
await each('trips.txt', (t) => { if (pilot[t.route_id]) trips.push(t); });
const tripIds = new Set(trips.map((t) => t.trip_id));
const times = {}; // trip_id -> [{stop, a, d}]
await each('stop_times.txt', (s) => { if (tripIds.has(s.trip_id)) (times[s.trip_id] ??= []).push({ stop: s.stop_id, seq: +s.stop_sequence, a: sec(s.arrival_time), d: sec(s.departure_time) }); });
for (const k in times) times[k].sort((x, y) => x.seq - y.seq);

// pick, per route+direction, the most used shape and the trip with the most stops as the stop pattern
const groups = {};
for (const t of trips) ((groups[t.route_id] ??= {})[t.direction_id] ??= []).push(t);
const shapeIds = new Set(), stopIds = new Set();
const pick = {};
for (const [rid, dirs] of Object.entries(groups)) for (const [d, ts] of Object.entries(dirs)) {
  const n = {}; for (const t of ts) n[t.shape_id] = (n[t.shape_id] ?? 0) + 1;
  const shape = Object.entries(n).sort((a, b) => b[1] - a[1])[0][0];
  const rep = ts.filter((t) => t.shape_id === shape && times[t.trip_id]).sort((a, b) => times[b.trip_id].length - times[a.trip_id].length)[0];
  pick[rid + '|' + d] = { shape, rep, ts };
  shapeIds.add(shape); times[rep.trip_id].forEach((s) => stopIds.add(s.stop));
}
const shapes = {};
await each('shapes.txt', (p) => { if (shapeIds.has(p.shape_id)) (shapes[p.shape_id] ??= []).push([+p.shape_pt_sequence, +p.shape_pt_lon, +p.shape_pt_lat]); });
const stops = {};
await each('stops.txt', (s) => { if (stopIds.has(s.stop_id)) stops[s.stop_id] = { n: s.stop_name, lon: +s.stop_lon, lat: +s.stop_lat }; });

const r5 = (x) => Math.round(x * 1e5) / 1e5;
const out = {};
for (const [key, { shape, rep, ts }] of Object.entries(pick)) {
  const [rid, d] = key.split('|');
  // thin the shape to points >= 12 m apart (keeps the last)
  const raw = shapes[shape].sort((a, b) => a[0] - b[0]).map(([, x, y]) => [r5(x), r5(y)]);
  const line = [raw[0]];
  for (const p of raw.slice(1, -1)) if (dist(line.at(-1), p) >= 12) line.push(p);
  line.push(raw.at(-1));
  const cum = line.reduce((c, p, i) => (c.push(i ? c[i - 1] + dist(line[i - 1], p) : 0), c), []);
  // chainage of each stop: nearest shape vertex at or after the previous stop's (stops come in order along the route)
  let from = 0;
  const st = times[rep.trip_id].map((s) => {
    const p = stops[s.stop]; let best = from, bd = Infinity;
    for (let i = from; i < line.length; i++) { const dd = dist(line[i], [p.lon, p.lat]); if (dd < bd) { bd = dd; best = i; } }
    from = best;
    return { n: p.n, lon: r5(p.lon), lat: r5(p.lat), c: Math.round(cum[best]), a: s.a - times[rep.trip_id][0].d, d: s.d - times[rep.trip_id][0].d };
  });
  const starts = [...new Set(ts.filter((t) => times[t.trip_id]).map((t) => times[t.trip_id][0].d))].sort((a, b) => a - b);
  ((out[rid] ??= { no: pilot[rid], name: routeName[rid], dirs: [] }).dirs[+d] = { head: rep.trip_headsign, shape: line, stops: st, starts });
}
for (const r of Object.values(out)) r.dirs = r.dirs.filter(Boolean);
fs.mkdirSync('public/data', { recursive: true });
fs.writeFileSync('public/data/bus.json', JSON.stringify(out));
console.log('wrote public/data/bus.json', (fs.statSync('public/data/bus.json').size / 1024) | 0, 'KB;', Object.values(out).map((r) => `${r.no}: ${r.dirs.map((d) => `${d.stops.length} stops/${d.starts.length} trips`).join(', ')}`).join(' | '));
