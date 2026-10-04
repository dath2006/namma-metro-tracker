import type { StyleSpecification } from 'maplibre-gl';

export const R = 6371008.8;
export const RAD = Math.PI / 180;

/** Metres per degree of longitude / latitude at a latitude. */
export const mPerDeg = (lat: number) => ({ kx: R * Math.cos(lat * RAD) * RAD, ky: R * RAD });

export const hav = (a: number[], b: number[]) => {
  const h = Math.sin(((b[1] - a[1]) * RAD) / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(((b[0] - a[0]) * RAD) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

/** Cumulative distance (m) along a polyline. */
export const cumOf = (path: number[][]) => path.reduce<number[]>((c, p, i) => (c.push(i ? c[i - 1] + hav(path[i - 1], p) : 0), c), []);

/** Shift a point sideways by `m` metres to the left (negative = right) of a path bearing. */
export const sideOf = (lon: number, lat: number, bearing: number, m: number): [number, number] => {
  const th = (bearing - 90) * RAD;
  const { kx, ky } = mPerDeg(lat);
  return [lon + (m * Math.sin(th)) / kx, lat + (m * Math.cos(th)) / ky];
};

/** Bearing of the canonical path direction at a train (the stored bearing is the direction of travel). */
export const canon = (t: { dir: 1 | -1; bearing: number }) => (t.dir === 1 ? t.bearing : (t.bearing + 180) % 360);

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

/** Satellite basemap shared by the tracker and the admin editor. */
export const satStyle = (): StyleSpecification => ({
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    sat: { type: 'raster', tiles: [ESRI], tileSize: 256, maxzoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics · Metro data © OpenStreetMap contributors (ODbL)' },
  },
  layers: [{ id: 'sat', type: 'raster', source: 'sat', paint: { 'raster-brightness-max': 0.85, 'raster-saturation': -0.1 } }],
});
