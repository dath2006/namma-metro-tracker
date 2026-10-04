// Builds public/data/network.json from OSM geojson (Vonter/bmrcl-gtfs, ODbL) + Pink/Blue OSM relations.
// Run: node scripts/build-data.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const rd = (p) => JSON.parse(readFileSync(p, 'utf8'));
const shifts = rd('data/stop-offsets.json');
const R = 6371008.8;
const rad = Math.PI / 180;
const hav = ([x1, y1], [x2, y2]) => {
  const a = Math.sin(((y2 - y1) * rad) / 2) ** 2 + Math.cos(y1 * rad) * Math.cos(y2 * rad) * Math.sin(((x2 - x1) * rad) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

// Project point onto polyline (local planar approx, fine at segment scale). Returns chainage in metres + snap distance.
function project(path, cum, pt) {
  const kx = Math.cos(pt[1] * rad) * R * rad;
  const ky = R * rad;
  let best = { at: 0, d: Infinity };
  for (let i = 0; i < path.length - 1; i++) {
    const ax = (path[i][0] - pt[0]) * kx, ay = (path[i][1] - pt[1]) * ky;
    const bx = (path[i + 1][0] - pt[0]) * kx, by = (path[i + 1][1] - pt[1]) * ky;
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best.d) best = { d, at: cum[i] + t * (cum[i + 1] - cum[i]) };
  }
  return best;
}
const cumulative = (path) => path.reduce((c, p, i) => (c.push(i ? c[i - 1] + hav(path[i - 1], p) : 0), c), []);

// Stitch OSM way members (each with .geometry) into one polyline, flipping ways as needed.
function stitch(ways) {
  const gs = ways.map((w) => w.geometry.map((p) => [p.lon, p.lat]));
  let out = gs[0];
  for (const g of gs.slice(1)) {
    const end = out[out.length - 1];
    const fwd = hav(end, g[0]), rev = hav(end, g[g.length - 1]);
    out = out.concat((fwd <= rev ? g : [...g].reverse()).slice(fwd < 1 || rev < 1 ? 1 : 0));
  }
  // orient by first way: if the first way is reversed relative to the second, fix by checking joint
  const first = gs[0], second = gs[1];
  if (second && hav(first[0], second[0]) < hav(first[first.length - 1], second[0]) - 1) {
    return stitch([{ geometry: [...ways[0].geometry].reverse() }, ...ways.slice(1)]);
  }
  return out;
}

const geo = rd('data/raw/export.geojson');
const feats = geo.features;
const routeBy = (needle) => feats.find((f) => f.properties.name === needle).geometry.coordinates.map(([x, y]) => [x, y]);
const stationsOSM = feats.filter((f) => f.properties.railway === 'station');

const defs = [
  { id: 'purple', name: 'Purple Line', color: '#a23bec', rel: 'Purple', path: routeBy('Purple Line (Whitefield (Kadugodi) → Challaghatta)') },
  { id: 'green', name: 'Green Line', color: '#1faa59', rel: 'Green', path: routeBy('Green Line (Madavara -> Silk Institute)') },
  { id: 'yellow', name: 'Yellow Line', color: '#f5c518', rel: 'Yellow', path: routeBy('Yellow Line (Rashtreeya Vidyalaya Road → Delta Electronics Bommasandra)') },
];

// Underground = runs of stations tagged tunnel=yes in OSM (plus Majestic, level -2), with a 450 m ramp each side,
// clamped to stay clear of the neighbouring elevated stations. Portal positions are approximate.
function tunnelRanges(stations, osm) {
  const ug = (s) => osm.some((f) => f.properties.code === s.code && (f.properties.tunnel === 'yes' || s.code === 'KGWA'));
  const out = [];
  for (let i = 0; i < stations.length; i++) {
    if (!ug(stations[i])) continue;
    let j = i;
    while (j + 1 < stations.length && ug(stations[j + 1])) j++;
    const lo = i > 0 ? Math.max(stations[i].at - 450, stations[i - 1].at + 150) : stations[i].at;
    const hi = j < stations.length - 1 ? Math.min(stations[j].at + 450, stations[j + 1].at - 150) : stations[j].at;
    out.push([Math.round(lo), Math.round(hi)]);
    i = j;
  }
  return out;
}

const lines = defs.map((d) => {
  const cum = cumulative(d.path);
  const stations = stationsOSM
    .filter((f) => (f.properties['@relations'] || []).some((r) => r.rel === d.rel))
    .map((f) => {
      const p = f.properties;
      const pt = f.geometry.coordinates;
      const pr = project(d.path, cum, pt);
      const others = (p['@relations'] || []).map((r) => r.rel.toLowerCase()).filter((r) => r !== d.id);
      return { code: p.code, name: p.name, kn: p['name:kn'] ?? null, at: Math.round(pr.at), stop: Math.round(pr.at + (shifts[p.code] ?? 0)), snap: Math.round(pr.d), lon: pt[0], lat: pt[1], xfer: others };
    })
    .sort((a, b) => a.at - b.at);
  const far = stations.filter((s) => s.snap > 150);
  if (far.length) console.warn(d.id, 'stations >150m from track:', far.map((s) => `${s.name} ${s.snap}m`).join(', '));
  const tunnels = tunnelRanges(stations, stationsOSM);
  return { id: d.id, name: d.name, color: d.color, open: true, tunnels, length: Math.round(cum.at(-1)), path: d.path.map(([x, y]) => [+x.toFixed(6), +y.toFixed(6)]), stations };
});

// Pink / Blue: under construction, geometry only, never any trains.
if (existsSync('data/raw/pinkblue.json')) {
  const rels = rd('data/raw/pinkblue.json').elements;
  const nodes = existsSync('data/raw/pinkblue-nodes.json') ? Object.fromEntries(rd('data/raw/pinkblue-nodes.json').elements.map((n) => [n.id, n.tags ?? {}])) : {};
  const up = [
    { id: 'pink', name: 'Pink Line', color: '#e8548f', relId: 6119472 },
    { id: 'blue', name: 'Blue Line', color: '#2b7de9', relId: 21256532 },
  ];
  for (const u of up) {
    const rel = rels.find((r) => r.id === u.relId);
    const path = stitch(rel.members.filter((m) => m.type === 'way'));
    const cum = cumulative(path);
    const stops = rel.members.filter((m) => m.type === 'node').map((m) => ({ ref: m.ref, pt: [m.lon, m.lat], ...(nodes[m.ref] ?? {}) }));
    const stations = stops
      .map((s) => ({ code: `n${s.ref}`, name: (s.name ?? `Stop ${s.ref}`).replace(/\s*\(u\/c\)\s*$/, ''), kn: s['name:kn'] ?? null, at: Math.round(project(path, cum, s.pt).at), lon: s.pt[0], lat: s.pt[1], xfer: [] }))
      .sort((a, b) => a.at - b.at);
    lines.push({ id: u.id, name: u.name, color: u.color, open: false, tunnels: [], length: Math.round(cum.at(-1)), path: path.map(([x, y]) => [+x.toFixed(6), +y.toFixed(6)]), stations: stations.map((s) => ({ ...s, stop: s.at })) });
  }
}

// Interchanges for upcoming lines: any station within 300 m of another line's station.
for (const l of lines.filter((l) => !l.open))
  for (const s of l.stations)
    for (const o of lines) {
      if (o === l) continue;
      if (o.stations.some((t) => hav([s.lon, s.lat], [t.lon, t.lat]) < 300) && !s.xfer.includes(o.id)) s.xfer.push(o.id);
    }

// Timetables (headway bands + extra/short-turn trips) keyed by line/day.
const days = { monday: 'monday', weekday: 'weekday', saturday: 'saturday', sunday: 'sunday' };
const schedule = {};
for (const l of lines.filter((l) => l.open)) {
  schedule[l.id] = {};
  for (const [k, f] of Object.entries(days)) {
    const p = `data/raw/schedule/${f}-${l.id.toUpperCase()}.json`;
    if (existsSync(p)) schedule[l.id][k] = rd(p);
  }
}
// Purple weekday has manual corrections upstream; apply them to the weekday timetable.
const corr = rd('data/raw/schedule/weekday-PURPLE-manual-corrections.json');
const wp = schedule.purple.weekday;
for (const t of corr.remove_trips ?? []) {
  const m = wp.trips.find((x) => x.from === t.from && x.to === t.to);
  if (m) m.times = m.times.filter((x) => !t.times.includes(x));
}
for (const t of corr.add_trips ?? []) wp.trips.push(t);

// Direction convention: 'fwd' = increasing chainage = toward the last station.
for (const l of lines) l.ends = [l.stations[0].name, l.stations.at(-1).name];
mkdirSync('public/data', { recursive: true });
writeFileSync('public/data/network.json', JSON.stringify({ lines, schedule }));
for (const l of lines) console.log(l.id, l.open ? 'open' : 'upcoming', `${l.stations.length} stations`, `${(l.length / 1000).toFixed(1)} km`, l.stations.map((s) => s.name).join(' | ').slice(0, 160));
