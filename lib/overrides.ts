// Hand-made corrections to the OSM track geometry, edited in /admin and applied on top of public/data/network.json.
// Offsets are stored per original vertex, in metres east/north, so chainage (distance along the line) never changes:
// every station position, tunnel range and timetable keeps meaning what it meant, only where it is drawn moves.
import type { Line, Network } from './network';
import { cumOf, mPerDeg } from './geo';

export type LineOverride = {
  shift?: [number, number]; // whole-line nudge, m east/north
  offsets?: Record<number, [number, number]>; // per-vertex, m east/north
};
export type Overrides = {
  trackOffset?: number; // m from the centreline to each track; trains run on their own track
  lines?: Record<string, LineOverride>;
};

export const DEFAULT_TRACK_OFFSET = 2.5;

/** Dense per-vertex offsets (excluding the whole-line shift) for a line. */
export const vertexOffsets = (n: number, o?: LineOverride): [number, number][] => {
  const v: [number, number][] = Array.from({ length: n }, () => [0, 0]);
  for (const [i, d] of Object.entries(o?.offsets ?? {})) if (v[+i]) v[+i] = [d[0], d[1]];
  return v;
};

/** Original vertices moved by shift + offsets. */
export const buildPath = (orig: [number, number][], v: [number, number][], shift: [number, number] = [0, 0]): [number, number][] =>
  orig.map(([x, y], i) => {
    const { kx, ky } = mPerDeg(y);
    return [x + (v[i][0] + shift[0]) / kx, y + (v[i][1] + shift[1]) / ky];
  });

/** Only keep offsets that matter, rounded to centimetres. */
export const sparse = (v: [number, number][]): Record<number, [number, number]> => {
  const out: Record<number, [number, number]> = {};
  v.forEach(([x, y], i) => { if (Math.abs(x) + Math.abs(y) > 0.02) out[i] = [Math.round(x * 100) / 100, Math.round(y * 100) / 100]; });
  return out;
};

function pointAt(path: number[][], cum: number[], s: number): [number, number] {
  s = Math.min(Math.max(s, 0), cum.at(-1)!);
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
  const t = (s - cum[lo]) / (cum[hi] - cum[lo] || 1);
  return [path[lo][0] + (path[hi][0] - path[lo][0]) * t, path[lo][1] + (path[hi][1] - path[lo][1]) * t];
}

/** Network with the corrections applied. `cum` keeps the ORIGINAL chainage so nothing else needs to change. */
export function applyOverrides(net: Network, ov: Overrides | null | undefined): Network {
  if (!ov?.lines) return net;
  return {
    ...net,
    lines: net.lines.map((l: Line) => {
      const o = ov.lines![l.id];
      if (!o) return l;
      const cum = cumOf(l.path);
      const path = buildPath(l.path, vertexOffsets(l.path.length, o), o.shift);
      // stations sit on the corrected track, at the same chainage as before
      const stations = l.stations.map((s) => { const [lon, lat] = pointAt(path, cum, s.at); return { ...s, lon, lat }; });
      return { ...l, path, cum, stations };
    }),
  };
}
