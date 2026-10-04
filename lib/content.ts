// Server-side content for the crawlable pages (stations, lines), derived from the same data and timetable engine the map uses.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Line, Network } from './network';
import { createSim, inTunnel, type Sim } from './engine';

let _net: Network | undefined;
let _sim: Sim | undefined;
export const net = () => (_net ??= JSON.parse(readFileSync(path.join(process.cwd(), 'public', 'data', 'network.json'), 'utf8')) as Network);
const sim = () => (_sim ??= createSim(net()));

export const slugify = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
/** "Nadaprabhu Kempegowda Station, Majestic" -> "Majestic"; "Whitefield (Kadugodi)" -> "Whitefield". */
export const shortName = (n: string) => (n.includes(',') ? n.split(',').pop()!.trim() : n).replace(/\s*\(.*\)\s*$/, '');

export type StationPage = { code: string; slug: string; name: string; short: string; kn: string | null; lon: number; lat: number; lineIds: string[] };

let _stations: StationPage[] | undefined;
/** Every station on a line that is open today, merged across interchanges by station code. */
export function allStations(): StationPage[] {
  if (_stations) return _stations;
  const byCode = new Map<string, StationPage>();
  const used = new Set<string>();
  for (const l of net().lines.filter((x) => x.open))
    for (const s of l.stations) {
      const have = byCode.get(s.code);
      if (have) { have.lineIds.push(l.id); continue; }
      let slug = slugify(shortName(s.name));
      if (used.has(slug)) slug = `${slug}-${s.code.toLowerCase()}`;
      used.add(slug);
      byCode.set(s.code, { code: s.code, slug, name: s.name, short: shortName(s.name), kn: s.kn, lon: s.lon, lat: s.lat, lineIds: [l.id] });
    }
  return (_stations = [...byCode.values()]);
}
export const stationBySlug = (slug: string) => allStations().find((s) => s.slug === slug);
export const stationByCode = (code: string) => allStations().find((s) => s.code === code);
export const lineById = (id: string) => net().lines.find((l) => l.id === id);

const hhmm = (sec: number) => {
  const m = Math.round(sec / 60) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
const perHour = (times: number[], h: number) => times.filter((t) => t >= h * 3600 && t < (h + 1) * 3600).length;
const every = (count: number) => (count ? Math.round((60 / count) * 10) / 10 : null);

export type Timing = { line: Line; toward: string; first: string; last: string; peak: number | null; offPeak: number | null };

/** Approximate weekday first/last train and headways at a station, per line and direction, from the timetable simulation. */
export function timings(code: string): Timing[] {
  const s = sim();
  const out: Timing[] = [];
  net().lines.forEach((l, li) => {
    if (!l.open) return;
    const idx = l.stations.findIndex((x) => x.code === code);
    if (idx < 0) return;
    const trips = s.tripsFor('weekday').filter((t) => t.line === li);
    for (const dir of [1, -1] as const) {
      const leg = s.legs[li]![dir];
      const k = leg.seq.indexOf(idx);
      if (k === leg.seq.length - 1) continue; // trains only terminate here in this direction
      const times: number[] = [];
      for (const t of trips) {
        if (t.dir !== dir) continue;
        const k0 = leg.seq.indexOf(t.i0), k1 = leg.seq.indexOf(t.i1);
        if (k < k0 || k > k1) continue;
        times.push(k === k0 ? t.t0 : t.t0 + leg.arr[k] - leg.dep[k0]);
      }
      if (!times.length) continue;
      out.push({
        line: l,
        toward: dir === 1 ? l.stations.at(-1)!.name : l.stations[0].name,
        first: hhmm(Math.min(...times)),
        last: hhmm(Math.max(...times)),
        peak: every(perHour(times, 9)),
        offPeak: every(perHour(times, 13)),
      });
    }
  });
  return out;
}

export type Neighbours = { line: Line; prev: StationPage | null; next: StationPage | null; towardPrev: string; towardNext: string; underground: boolean };
export function neighbours(code: string): Neighbours[] {
  return net().lines.filter((l) => l.open).flatMap((l) => {
    const i = l.stations.findIndex((x) => x.code === code);
    if (i < 0) return [];
    const at = (j: number) => (l.stations[j] ? stationByCode(l.stations[j].code) ?? null : null);
    return [{ line: l, prev: at(i - 1), next: at(i + 1), towardPrev: shortName(l.stations[0].name), towardNext: shortName(l.stations.at(-1)!.name), underground: inTunnel(l, l.stations[i].at) }];
  });
}

export const lineName = (id: string) => lineById(id)?.name ?? id;
export const lineKm = (l: Line) => Math.round(l.length / 100) / 10;
/** "Purple Line (Challaghatta – Whitefield)" */
export const lineTitle = (l: Line) => `${l.name} (${shortName(l.stations[0].name)} – ${shortName(l.stations.at(-1)!.name)})`;
