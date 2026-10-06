'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css'; // here, not in the layout, so the plain SEO pages do not load it
import type { Network } from '@/lib/network';
import { parseRoutes, routeBounds, simBuses, stopPoints, type BusRoute, type BusView, type RawBusRoute, type SimBus } from '@/lib/busSim';
import { CONFIG, createSim, inTunnel, lateralAt, setTrackOffset, type Sim, type TrainState } from '@/lib/engine';
import { applyOverrides, DEFAULT_TRACK_OFFSET, type Overrides } from '@/lib/overrides';
import { canon, R, RAD, satStyle, sideOf } from '@/lib/geo';
import { BusCard, BusSearch, ClockBar, Header, LineStrip, TrackHint, TrackPrompt, TrainCard, type BusIndexRow, type BusSel, type CamMode, type Theme } from './Panels';

maplibregl.setWorkerUrl('/maplibre/maplibre-gl-worker.mjs'); // Turbopack can't bundle the worker; served from public/ (copied by predev/prebuild)

const VIADUCT_M = 9; // rail height of the elevated sections
const DOOR_TEXT: Record<string, string> = { opening: 'Doors opening', open: 'Doors open', closing: 'Doors closing' };
const DOOR_COLOR: Record<string, string> = { closed: '#aab1c2', opening: '#ffb020', open: '#27e08a', closing: '#ffb020' };
const empty = { type: 'FeatureCollection', features: [] } as never;
const fmt = (ms: number) => new Date(ms).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true });

// Camera presets used while following a train. Zoom/pitch settle once; bearing and centre track continuously.
const PRESET: Record<Exclude<CamMode, 'free'>, { zoom: number; pitch: number }> = {
  chase: { zoom: 18.1, pitch: 66 },
  cockpit: { zoom: 19.4, pitch: 80 },
  top: { zoom: 17.2, pitch: 0 },
  orbit: { zoom: 18.1, pitch: 62 },
};
type Mode = 'both' | 'metro' | 'bus';
const MODES: [Mode, string][] = [['both', 'Combined'], ['metro', 'Metro only'], ['bus', 'Bus only']];

// A bus is ~11.5 x 2.55 m, so the follow-camera sits much closer than for a 136 m rake.
const BUS_PRESET: Record<Exclude<CamMode, 'free'>, { zoom: number; pitch: number }> = {
  chase: { zoom: 19.3, pitch: 66 },
  cockpit: { zoom: 20.4, pitch: 80 },
  top: { zoom: 18.8, pitch: 0 },
  orbit: { zoom: 19.3, pitch: 62 },
};
const BUS_LEN = 11.5, BUS_HW = 1.275;
const BUS_LAYERS = ['bus3d-body', 'bus3d-stripe', 'bus3d-glass', 'bus3d-lamp'];
let busData: Promise<RawBusRoute[]> | null = null; // one download per page load, shared by remounts and mode toggles
const BUS_SIM_MS = 250; // every route is re-simulated this often for the dots; the 3D models and the follow camera are simulated every frame
const toView = (x: SimBus, heading = x.heading): BusView => ({ id: x.id, route: x.route, rid: x.rid, reg: '', ac: false, sim: true, lon: x.lon, lat: x.lat, heading, speed: x.speed, ts: 0, next: x.next, head: x.head, dist: x.dist, eta: x.eta });
const wrap = (d: number) => ((d + 540) % 360) - 180;

// 0 = day, 1 = night, with 1 h ramps at dusk and dawn (IST).
function nightFactor(ms: number) {
  const h = (ms / 3600e3 + 5.5) % 24;
  if (h >= 18.75 || h < 5.5) return 1;
  if (h >= 17.75) return h - 17.75;
  if (h < 6.5) return 1 - (h - 5.5);
  return 0;
}
const mix = (a: string, b: string, f: number) => {
  const p = (s: string) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * f).toString(16).padStart(2, '0')).join('');
};

// One coach as a polygon in a local metric frame: centre c, heading hdg (deg). Cab ends are tapered.
function coachRing(lon: number, lat: number, hdg: number, hw: number, hl: number, front: boolean, rear: boolean) {
  const h = hdg * RAD, fx = Math.sin(h), fy = Math.cos(h), rx = Math.cos(h), ry = -Math.sin(h);
  const mLon = 1 / (R * Math.cos(lat * RAD) * RAD), mLat = 1 / (R * RAD);
  const pt = (df: number, dr: number): [number, number] => [lon + (fx * df + rx * dr) * mLon, lat + (fy * df + ry * dr) * mLat];
  const n = 2.4, t = 0.6;
  const p: [number, number][] = [];
  if (rear) p.push(pt(-hl, -hw * t), pt(-hl + n, -hw)); else p.push(pt(-hl, -hw));
  if (front) p.push(pt(hl - n, -hw), pt(hl, -hw * t), pt(hl, hw * t), pt(hl - n, hw)); else p.push(pt(hl, -hw), pt(hl, hw));
  if (rear) p.push(pt(-hl + n, hw), pt(-hl, hw * t)); else p.push(pt(-hl, hw));
  p.push(p[0]);
  return p;
}
// Local metric frame at (lon, lat) with heading hdg: returns a function mapping (forward m, right m) to [lon, lat].
const frame = (lon: number, lat: number, hdg: number) => {
  const h = hdg * RAD, fx = Math.sin(h), fy = Math.cos(h), rx = Math.cos(h), ry = -Math.sin(h);
  const mLon = 1 / (R * Math.cos(lat * RAD) * RAD), mLat = 1 / (R * RAD);
  return (df: number, dr: number): [number, number] => [lon + (fx * df + rx * dr) * mLon, lat + (fy * df + ry * dr) * mLat];
};
const rect = (pt: ReturnType<typeof frame>, df0: number, df1: number, dr0: number, dr1: number) => [pt(df0, dr0), pt(df1, dr0), pt(df1, dr1), pt(df0, dr1), pt(df0, dr0)];
// Headlight cones: nested, widening slabs ahead of the cab. Stacked translucent layers read as a soft gradient.
const BEAMS = [{ len: 80, w: 18 }, { len: 62, w: 14 }, { len: 46, w: 10 }, { len: 32, w: 7 }, { len: 20, w: 4.2 }];
const METRO_LAYERS = ['line-glow', 'line-core', 'line-upcoming', 'tunnels', 'stations', 'station-labels', 'head-halo', 'head', 'head-label', 'rake-body', 'rake-stripe', 'rake-glass', 'rake-lamp', 'rake-door', ...BEAMS.map((_, i) => `beam-${i}`)];

export default function MetroMap() {
  const el = useRef<HTMLDivElement>(null);
  const [net, setNet] = useState<Network | null>(null);
  const [sel, setSel] = useState<TrainState | null>(null);
  const [cam, setCamState] = useState<CamMode>('chase');
  const [clock, setClock] = useState('');
  const [speed, setSpeedState] = useState(1);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [theme, setThemeState] = useState<Theme>('auto');
  const [night, setNight] = useState(false);
  const [suggest, setSuggest] = useState<TrainState | null>(null); // randomly chosen train offered for tracking
  const [promptOpen, setPromptOpen] = useState(true);
  const [mode, setModeState] = useState<Mode>('both');
  const [busState, setBusState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [simN, setSimN] = useState(0);
  const [selBus, setSelBus] = useState<BusSel | null>(null);
  const [busIndex, setBusIndex] = useState<BusIndexRow[]>([]);
  const [activeRoute, setActiveRoute] = useState<{ no: string; name: string } | null>(null);

  // Mutable state read by the animation loop, kept out of React to avoid re-renders per frame.
  const ctl = useRef({
    speed: 1, cam: 'chase' as CamMode, following: false, settleUntil: 0, orbit: 0, theme: 'auto' as Theme,
    selId: null as string | null, clock: 0, map: null as maplibregl.Map | null,
    prompt: true, suggestId: null as string | null, track: null as ((id: string) => void) | null,
    mode: 'both' as Mode, applyMode: null as ((m: Mode) => void) | null,
    selBusId: null as string | null, hd: new Map<string, number>(), simAll: [] as SimBus[], simAt: 0, viewRoutes: [] as BusRoute[],
    routes: [] as BusRoute[], byId: new Map<number, BusRoute>(), route: null as number | null, simN: 0, drawHL: null as (() => void) | null, setRoute: null as ((id: number | null) => void) | null,
  });
  const setMode = (m: Mode) => {
    const c = ctl.current;
    c.mode = m; setModeState(m); c.applyMode?.(m);
    if (m === 'metro' && c.selBusId) { c.selBusId = null; setSelBus(null); if (!c.selId) c.following = false; }
  };
  const closeBus = () => { const c = ctl.current; c.selBusId = null; c.following = false; setSelBus(null); };
  const setSpeed = (n: number) => { ctl.current.speed = n; setSpeedState(n); };
  const setTheme = (t: Theme) => { ctl.current.theme = t; setThemeState(t); };
  const setCam = (m: CamMode) => {
    const c = ctl.current;
    c.cam = m; setCamState(m);
    c.following = m !== 'free';
    c.settleUntil = performance.now() + 2200;
    c.orbit = c.map?.getBearing() ?? 0;
  };
  const close = () => { const c = ctl.current; c.selId = null; c.following = false; c.prompt = true; setSel(null); setPromptOpen(true); };
  const dismissPrompt = () => { ctl.current.prompt = false; ctl.current.suggestId = null; setPromptOpen(false); setSuggest(null); };
  const shuffle = () => { ctl.current.suggestId = null; ctl.current.prompt = true; setPromptOpen(true); }; // a new pick is made on the next UI tick
  const jump = (h: number) => {
    // h = hour of the day IST today; -1 = back to real time
    const now = Date.now();
    if (h < 0) { ctl.current.clock = now; setSpeed(1); return; }
    const ist = new Date(now + 5.5 * 3600e3);
    ctl.current.clock = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), h) - 5.5 * 3600e3;
  };

  useEffect(() => {
    // Hand-made track corrections from /admin are applied on top of the OSM geometry.
    Promise.all([fetch('/data/network.json').then((r) => r.json()), fetch('/api/overrides').then((r) => r.json()).catch(() => ({}))]).then(([n, o]: [Network, Overrides]) => {
      setTrackOffset(o?.trackOffset ?? DEFAULT_TRACK_OFFSET);
      setNet(applyOverrides(n, o));
    });
  }, []);
  const sim = useMemo<Sim | null>(() => (net ? createSim(net) : null), [net]);

  useEffect(() => {
    if (!el.current || !net || !sim) return;
    const idx = Object.fromEntries(net.lines.map((l, i) => [l.id, i]));
    const c = ctl.current;
    c.clock = Date.now();
    // Deep links from the station and line pages: /?station=KGWA or /?line=purple
    const q = new URLSearchParams(window.location.search);
    const st = net.lines.flatMap((l) => l.stations).find((x) => x.code === q.get('station'));
    const ln = net.lines.find((l) => l.id === q.get('line'));
    const mid = ln?.stations[Math.floor(ln.stations.length / 2)];
    const view: { center: [number, number]; zoom: number; pitch: number } = st
      ? { center: [st.lon, st.lat], zoom: 16.4, pitch: 55 }
      : mid ? { center: [mid.lon, mid.lat], zoom: 11.2, pitch: 30 } : { center: [77.5946, 12.9716], zoom: 11.8, pitch: 30 };
    if (st) c.prompt = false; // they came for a specific place, not a random train
    const map = new maplibregl.Map({
      container: el.current,
      ...view,
      maxPitch: 85,
      attributionControl: { compact: true },
      style: satStyle(),
    });
    c.map = map;
    if (process.env.NODE_ENV !== 'production') (window as unknown as { __map: unknown }).__map = map; // dev-only handle for debugging
    map.on('error', (e) => console.error('[map]', e.error?.message ?? e));
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
    map.on('dragstart', () => { if (c.following) { c.following = false; c.cam = 'free'; setCamState('free'); } });

    let raf = 0;
    const cleanup: (() => void)[] = [];
    let lastTrains: TrainState[] = [];
    let lastFresh: BusView[] = []; // buses simulated this frame (3D models / tracked bus)
    map.once('style.load', () => {
      if (st) setPromptOpen(false);
      // style.load, not 'load': that waits for every satellite tile, so slow imagery would delay the overlay
      const open = ['==', ['get', 'open'], true];
      const w = (a: number, b: number) => ['interpolate', ['linear'], ['zoom'], 10, a, 17, b];
      // Underground stretches, sampled from the track every 20 m.
      const tunnelFeatures = net.lines.flatMap((l, li) => l.tunnels.map(([a, b]) => ({
        type: 'Feature', properties: { color: l.color },
        geometry: { type: 'LineString', coordinates: Array.from({ length: Math.ceil((b - a) / 20) + 1 }, (_, i) => sim.posAt(li, Math.min(a + i * 20, b)).slice(0, 2)) },
      })));
      map.addSource('lines', { type: 'geojson', data: { type: 'FeatureCollection', features: net.lines.map((l) => ({ type: 'Feature', properties: { color: l.color, open: l.open }, geometry: { type: 'LineString', coordinates: l.path } })) } as never });
      map.addSource('tunnels', { type: 'geojson', data: { type: 'FeatureCollection', features: tunnelFeatures } as never });
      map.addSource('stations', { type: 'geojson', data: { type: 'FeatureCollection', features: net.lines.flatMap((l) => l.stations.map((s) => ({ type: 'Feature', properties: { name: s.name, color: l.color, open: l.open }, geometry: { type: 'Point', coordinates: [s.lon, s.lat] } }))) } as never });
      map.addSource('rakes', { type: 'geojson', data: empty });
      map.addSource('heads', { type: 'geojson', data: empty });
      map.addSource('beams', { type: 'geojson', data: empty });
      map.addLayer({ id: 'line-glow', type: 'line', source: 'lines', filter: open as never, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': w(7, 12) as never, 'line-blur': 6, 'line-opacity': 0.45 } });
      map.addLayer({ id: 'line-core', type: 'line', source: 'lines', filter: open as never, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': w(3.5, 3) as never } });
      map.addLayer({ id: 'line-upcoming', type: 'line', source: 'lines', filter: ['!', open] as never, paint: { 'line-color': ['get', 'color'], 'line-width': w(2.5, 4) as never, 'line-dasharray': [2, 2], 'line-opacity': 0.85 } });
      map.addLayer({ id: 'tunnels', type: 'line', source: 'tunnels', paint: { 'line-color': '#0b0d14', 'line-width': w(4, 4) as never, 'line-opacity': 0.8, 'line-dasharray': [1, 1.5] } });
      map.addLayer({ id: 'stations', type: 'circle', source: 'stations', paint: { 'circle-radius': w(3, 7) as never, 'circle-color': ['case', open as never, '#fff', '#222'], 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': w(1.5, 3) as never } });

      // Scheduled BMTC buses: every route in the timetable feed is simulated, like the metro. Dots below zoom 15, 3D models above.
      // A route's line and stops are drawn only while one of its buses is hovered or tracked (or the route was picked in search).
      map.addSource('bus-routes', { type: 'geojson', data: empty });
      map.addSource('bus-stops', { type: 'geojson', data: empty });
      map.addSource('buses', { type: 'geojson', data: empty });
      map.addSource('bus3d', { type: 'geojson', data: empty });
      map.addLayer({ id: 'bus-line', type: 'line', source: 'bus-routes', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#f59e0b', 'line-width': w(3, 5) as never, 'line-opacity': 0.95 } });
      map.addLayer({ id: 'bus-stops', type: 'circle', source: 'bus-stops', minzoom: 11.5, paint: { 'circle-radius': w(2.5, 5) as never, 'circle-color': '#fff', 'circle-stroke-color': '#f59e0b', 'circle-stroke-width': 1.5 } });
      map.addLayer({ id: 'bus-stop-label', type: 'symbol', source: 'bus-stops', minzoom: 14.5, layout: { 'text-field': ['get', 'name'], 'text-font': ['Open Sans Regular,Arial Unicode MS Regular'], 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true }, paint: { 'text-color': '#fff', 'text-halo-color': 'rgba(8,10,18,0.9)', 'text-halo-width': 1.5 } });
      map.addLayer({ id: 'bus', type: 'circle', source: 'buses', maxzoom: 15, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 1.6, 12, 3, 15, 6] as never, 'circle-color': '#f59e0b', 'circle-opacity': 0.9, 'circle-stroke-color': '#0b0d14', 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 8, 0, 12, 1, 15, 1.5] as never } });
      const bpart = (id: string, p: string, base: number, top: number, color: unknown) =>
        map.addLayer({ id, type: 'fill-extrusion', source: 'bus3d', minzoom: 15, filter: ['==', ['get', 'part'], p], paint: { 'fill-extrusion-color': color as never, 'fill-extrusion-base': base, 'fill-extrusion-height': top, 'fill-extrusion-vertical-gradient': true } });
      bpart('bus3d-body', 'body', 0.45, 3.3, ['case', ['get', 'sel'], '#f7f0d2', '#e8ebf2']);
      bpart('bus3d-stripe', 'stripe', 0.9, 1.5, ['get', 'color']);
      bpart('bus3d-glass', 'glass', 1.7, 2.9, '#101722');
      bpart('bus3d-lamp', 'lamp', 0.7, 1.2, ['get', 'lc']);
      map.addLayer({ id: 'bus-label', type: 'symbol', source: 'bus3d', minzoom: 15, filter: ['==', ['get', 'part'], 'label'], layout: { 'text-field': ['get', 'route'], 'text-font': ['Open Sans Regular,Arial Unicode MS Regular'], 'text-size': 11, 'text-offset': [0, -1.4], 'text-optional': true }, paint: { 'text-color': '#fff', 'text-halo-color': 'rgba(8,10,18,0.9)', 'text-halo-width': 1.5 } });

      const trackBus = (v: BusView) => {
        c.selBusId = v.id;
        c.selId = null; setSel(null);
        c.prompt = false; setPromptOpen(false); setSuggest(null);
        c.following = false; // following starts once the fly-to lands
        c.cam = 'chase'; setCamState('chase');
        map.flyTo({ center: [v.lon, v.lat], zoom: Math.max(map.getZoom(), 18), pitch: 60, bearing: v.heading, duration: 2200 });
        map.once('moveend', () => { if (c.selBusId === v.id && c.cam !== 'free') { c.following = true; c.settleUntil = performance.now() + 2200; c.orbit = map.getBearing(); } });
      };

      // Highlight: the route of the hovered bus, else of the tracked bus, else the one picked in search. sim ids are "sim-<routeId>-...".
      let hoverRid: number | null = null, drawn: number | null = -1;
      const drawHL = () => {
        const rid = hoverRid ?? (c.selBusId ? +c.selBusId.split('-')[1] : null) ?? c.route;
        if (rid === drawn) return;
        drawn = rid;
        const r = rid === null ? undefined : c.byId.get(rid);
        (map.getSource('bus-routes') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: (r?.dirs ?? []).map((d) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: Array.from(d.lon, (x, i) => [x, d.lat[i]]) } })) } as never);
        (map.getSource('bus-stops') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: (r ? stopPoints(r) : []).map((p) => ({ type: 'Feature', properties: { name: p.n }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } })) } as never);
      };
      c.drawHL = drawHL;
      for (const l of ['bus', ...BUS_LAYERS]) {
        map.on('mouseenter', l, () => (map.getCanvas().style.cursor = 'pointer'));
        map.on('mousemove', l, (e) => { const rid = e.features?.[0]?.properties?.rid; if (rid !== undefined && +rid !== hoverRid) { hoverRid = +rid; drawHL(); } });
        map.on('mouseleave', l, () => { map.getCanvas().style.cursor = ''; hoverRid = null; drawHL(); });
        map.on('click', l, (e) => {
          const id = e.features?.[0]?.properties?.id as string | undefined;
          const sb = lastFresh.find((x) => x.id === id) ?? (() => { const x = c.simAll.find((y) => y.id === id); return x && toView(x); })();
          if (sb) trackBus(sb);
        });
      }

      let dead = false; // set on cleanup: a late fetch must not touch a removed map (React dev double-mount)
      let loaded = false;
      const loadStatic = () => {
        if (loaded) return;
        loaded = true;
        setBusState('loading');
        busData ??= fetch('/data/bus/all.json').then((r) => (r.ok ? (r.json() as Promise<RawBusRoute[]>) : Promise.reject(new Error(String(r.status))))).catch((e) => { busData = null; throw e; });
        busData.then((raw) => {
          if (dead) return;
          c.routes = parseRoutes(raw);
          c.byId = new Map(c.routes.map((r) => [r.id, r]));
          setBusIndex(c.routes.map((r) => [r.id, r.no, r.name]));
          setBusState('ready');
        }).catch(() => { loaded = false; if (!dead) setBusState('error'); });
      };
      c.setRoute = (id) => {
        c.route = id;
        const r = id === null ? undefined : c.byId.get(id);
        setActiveRoute(r ? { no: r.no, name: r.name } : null);
        c.simAt = 0; // refresh the dots now
        drawHL();
        if (r) {
          const [w0, s0, e0, n0] = routeBounds(r);
          map.fitBounds([[w0, s0], [e0, n0]], { padding: { top: 150, bottom: 70, left: 60, right: 60 }, maxZoom: 14, pitch: 0, bearing: 0, duration: 1500 });
        }
      };
      c.applyMode = (m) => {
        METRO_LAYERS.forEach((id) => map.setLayoutProperty(id, 'visibility', m === 'bus' ? 'none' : 'visible'));
        ['bus-line', 'bus-stops', 'bus-stop-label', 'bus', 'bus-label', ...BUS_LAYERS].forEach((id) => map.setLayoutProperty(id, 'visibility', m === 'metro' ? 'none' : 'visible'));
        if (m !== 'metro') loadStatic();
      };
      cleanup.push(() => { dead = true; c.applyMode = null; c.drawHL = null; });

      // Headlight cones sit at cab height, under the rake layers. Opacity is driven by the night factor (applyTheme).
      BEAMS.forEach((_, i) => map.addLayer({ id: `beam-${i}`, type: 'fill-extrusion', source: 'beams', minzoom: 15, filter: ['==', ['get', 'lvl'], i], paint: { 'fill-extrusion-color': '#fff3c4', 'fill-extrusion-base': VIADUCT_M + 1.25, 'fill-extrusion-height': VIADUCT_M + 1.3, 'fill-extrusion-opacity': 0, 'fill-extrusion-vertical-gradient': false } }));

      // 3D rake: body, livery stripe and glazing as three extrusions of the same footprint.
      const part = (id: string, p: string, base: number, top: number, color: unknown) =>
        map.addLayer({ id, type: 'fill-extrusion', source: 'rakes', minzoom: 15, filter: ['==', ['get', 'part'], p], paint: { 'fill-extrusion-color': color as never, 'fill-extrusion-base': VIADUCT_M + base, 'fill-extrusion-height': VIADUCT_M + top, 'fill-extrusion-vertical-gradient': true } });
      part('rake-body', 'body', 0.5, 3.8, ['case', ['get', 'sel'], '#f7f0d2', '#e8ebf2']);
      part('rake-stripe', 'stripe', 0.9, 1.5, ['get', 'color']);
      part('rake-glass', 'glass', 1.9, 3.1, '#101722');
      part('rake-lamp', 'lamp', 1.0, 1.6, ['get', 'lc']);
      map.addLayer({ id: 'rake-door', type: 'fill-extrusion', source: 'rakes', minzoom: 16.3, filter: ['==', ['get', 'part'], 'door'], paint: { 'fill-extrusion-color': ['get', 'dc'], 'fill-extrusion-base': VIADUCT_M + 0.7, 'fill-extrusion-height': VIADUCT_M + 2.9, 'fill-extrusion-vertical-gradient': false } }); // door panels turn green when open, amber while moving // white headlamps at the front, red tail lamps at the back

      map.addLayer({ id: 'head-halo', type: 'circle', source: 'heads', maxzoom: 15, paint: { 'circle-radius': ['case', ['get', 'sel'], 11, 8], 'circle-color': '#fff', 'circle-opacity': ['case', ['get', 'ug'], 0.35, 0.95] } });
      map.addLayer({ id: 'head', type: 'circle', source: 'heads', maxzoom: 15, paint: { 'circle-radius': ['case', ['get', 'sel'], 8, 5.5], 'circle-color': ['get', 'color'], 'circle-opacity': ['case', ['get', 'ug'], 0.4, 1] } });
      map.addLayer({ id: 'head-label', type: 'symbol', source: 'heads', minzoom: 14, layout: { 'text-field': ['get', 'label'], 'text-font': ['Open Sans Regular,Arial Unicode MS Regular'], 'text-size': 11, 'text-offset': [0, -1.6], 'text-optional': true }, paint: { 'text-color': '#fff', 'text-halo-color': 'rgba(8,10,18,0.9)', 'text-halo-width': 1.5 } });
      map.addLayer({ id: 'station-labels', type: 'symbol', source: 'stations', minzoom: 12.5, layout: { 'text-field': ['get', 'name'], 'text-font': ['Open Sans Regular,Arial Unicode MS Regular'], 'text-size': w(10, 14) as never, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true }, paint: { 'text-color': '#fff', 'text-halo-color': 'rgba(8,10,18,0.9)', 'text-halo-width': 1.6 } });

      const track = (t: TrainState) => {
        c.selId = t.id;
        c.selBusId = null; setSelBus(null);
        c.prompt = false; setPromptOpen(false); setSuggest(null);
        c.following = false; // a per-frame jumpTo would cancel the fly-to, so following starts when it lands
        c.cam = 'chase'; setCamState('chase');
        map.flyTo({ center: [t.lon, t.lat], zoom: Math.max(map.getZoom(), 17), pitch: 60, bearing: t.bearing, duration: 2200 });
        map.once('moveend', () => { if (c.selId === t.id && c.cam !== 'free') { c.following = true; c.settleUntil = performance.now() + 2200; c.orbit = map.getBearing(); } });
      };
      c.track = (id) => { const t = lastTrains.find((x) => x.id === id); if (t) track(t); };

      for (const l of ['head', 'rake-body', 'rake-glass', 'rake-stripe', 'rake-door']) {
        map.on('mouseenter', l, () => (map.getCanvas().style.cursor = 'pointer'));
        map.on('mouseleave', l, () => (map.getCanvas().style.cursor = ''));
        map.on('click', l, (e) => {
          const id = e.features?.[0]?.properties?.id as string | undefined;
          const t = lastTrains.find((x) => x.id === id);
          if (t) track(t);
        });
      }

      const applyTheme = (f: number) => {
        map.setPaintProperty('sat', 'raster-brightness-max', 0.85 - 0.5 * f);
        map.setPaintProperty('sat', 'raster-saturation', -0.1 - 0.3 * f);
        map.setPaintProperty('rake-body', 'fill-extrusion-color', ['case', ['get', 'sel'], mix('#f7f0d2', '#a39f86', f), mix('#e8ebf2', '#8f97ab', f)]);
        map.setPaintProperty('rake-glass', 'fill-extrusion-color', mix('#101722', '#ffe29a', f)); // lit windows at night
        map.setPaintProperty('bus3d-body', 'fill-extrusion-color', ['case', ['get', 'sel'], mix('#f7f0d2', '#a39f86', f), mix('#e8ebf2', '#8f97ab', f)]);
        map.setPaintProperty('bus3d-glass', 'fill-extrusion-color', mix('#101722', '#ffe29a', f));
        BEAMS.forEach((_, i) => map.setPaintProperty(`beam-${i}`, 'fill-extrusion-opacity', Math.max(0, f - 0.15) * 0.16));
      };

      // Eases the camera towards a look-at point and bearing; zoom/pitch settle to the preset for the first moments of a follow.
      const steer = (target: [number, number], tb: number, pre: { zoom: number; pitch: number }, dt: number, now: number, zoom: number) => {
        const settling = now < c.settleUntil;
        const cur = map.getCenter();
        const kc = settling ? 1 - Math.exp(-dt * 7) : 1;
        const kb = 1 - Math.exp(-dt * (settling ? 3 : 2.5));
        const kz = 1 - Math.exp(-dt * 3);
        map.jumpTo({
          center: [cur.lng + (target[0] - cur.lng) * kc, cur.lat + (target[1] - cur.lat) * kc],
          bearing: map.getBearing() + wrap(tb - map.getBearing()) * kb,
          ...(settling ? { zoom: zoom + (pre.zoom - zoom) * kz, pitch: map.getPitch() + (pre.pitch - map.getPitch()) * kz } : {}),
        });
      };
      const busParts = (v: BusView, sel: boolean) => {
        const pt = frame(v.lon, v.lat, v.heading), hl = BUS_LEN / 2;
        const props = { id: v.id, sel, color: v.ac ? '#22d3ee' : '#f59e0b' };
        const out: unknown[] = [];
        for (const [part, hw] of [['body', BUS_HW], ['stripe', BUS_HW + 0.02], ['glass', BUS_HW + 0.04]] as const)
          out.push({ type: 'Feature', properties: { ...props, part }, geometry: { type: 'Polygon', coordinates: [rect(pt, -hl, hl, -hw, hw)] } });
        for (const sgn of [-1, 1]) {
          out.push({ type: 'Feature', properties: { ...props, part: 'lamp', lc: '#fff7d6' }, geometry: { type: 'Polygon', coordinates: [rect(pt, hl - 0.12, hl + 0.1, sgn * 0.6, sgn * 1.0)] } });
          out.push({ type: 'Feature', properties: { ...props, part: 'lamp', lc: '#ff3030' }, geometry: { type: 'Polygon', coordinates: [rect(pt, -hl - 0.1, -hl + 0.12, sgn * 0.6, sgn * 1.0)] } });
        }
        return out;
      };

      let last = performance.now(), lastDraw = last, lastUi = 0, lastF = -1;
      const tick = (now: number) => {
        c.clock += (now - last) * c.speed;
        last = now;
        if (now - lastDraw > 33) { // ~30 fps map updates
          const dt = (now - lastDraw) / 1000;
          lastDraw = now;
          const trains = (lastTrains = c.mode === 'bus' ? [] : sim.getTrains(c.clock));
          const zoom = map.getZoom();
          const b = map.getBounds();
          const pad = 0.004;
          const seen = (t: { lon: number; lat: number }) => t.lon > b.getWest() - pad && t.lon < b.getEast() + pad && t.lat > b.getSouth() - pad && t.lat < b.getNorth() + pad;
          const rakes: unknown[] = [];
          const heads: unknown[] = [];
          const beams: unknown[] = [];
          const dark = lastF > 0.2; // headlight cones only once it is getting dark
          for (const t of trains) {
            const li = idx[t.line], line = net.lines[li];
            const isSel = t.id === c.selId;
            const [hx, hy] = sideOf(t.lon, t.lat, canon(t), lateralAt(t, t.chainage));
            heads.push({ type: 'Feature', properties: { id: t.id, color: t.color, sel: isSel, ug: t.underground, label: `${t.id}\n${t.speed > 0.3 ? `${Math.round(t.speed * 3.6)} km/h` : DOOR_TEXT[t.doors] ?? 'Stopped'}` }, geometry: { type: 'Point', coordinates: [hx, hy] } });
            if (zoom < 15 || !seen(t)) continue;
            const L = CONFIG.coachLen;
            for (let k = 0; k < t.coaches; k++) {
              const mid = t.chainage - t.dir * (k * (L + CONFIG.coachGap) + L / 2);
              if (inTunnel(line, mid)) continue;
              const [lon0, lat0, b0] = sim.posAt(li, mid);
              const yaw = Math.atan((lateralAt(t, mid + 1) - lateralAt(t, mid - 1)) / 2) / RAD; // coach follows the crossover S-curve
              const hdg = ((t.dir === 1 ? b0 : b0 + 180) - yaw + 360) % 360;
              const [lon, lat] = sideOf(lon0, lat0, b0, lateralAt(t, mid)); // each coach sits on its own bit of track
              const front = k === 0, rear = k === t.coaches - 1;
              const props = { id: t.id, color: t.color, sel: isSel };
              const pt = frame(lon, lat, hdg);
              const lamp = (df0: number, df1: number, lc: string) => {
                for (const sgn of [-1, 1])
                  rakes.push({ type: 'Feature', properties: { ...props, part: 'lamp', lc }, geometry: { type: 'Polygon', coordinates: [rect(pt, df0, df1, sgn * 0.3, sgn * 0.7)] } });
              };
              if (front) {
                lamp(L / 2 - 0.3, L / 2 + 0.12, '#fff7d6');
                if (dark) BEAMS.forEach((bm, lvl) => beams.push({ type: 'Feature', properties: { lvl }, geometry: { type: 'Polygon', coordinates: [[pt(L / 2, -0.9), pt(L / 2 + bm.len, -bm.w), pt(L / 2 + bm.len, bm.w), pt(L / 2, 0.9), pt(L / 2, -0.9)]] } }));
              }
              if (rear) lamp(-L / 2 - 0.12, -L / 2 + 0.3, '#ff3030');
              if (zoom >= 16.3) // four doors per side, panel colour = door state
                for (const df of [-7, -2.4, 2.4, 7]) for (const sgn of [-1, 1])
                  rakes.push({ type: 'Feature', properties: { ...props, part: 'door', dc: DOOR_COLOR[t.doors] }, geometry: { type: 'Polygon', coordinates: [rect(pt, df - 0.7, df + 0.7, sgn * 1.53, sgn * 1.58)] } });
              for (const [p, grow] of [['body', 0], ['stripe', 0.02], ['glass', 0.04]] as const)
                rakes.push({ type: 'Feature', properties: { ...props, part: p }, geometry: { type: 'Polygon', coordinates: [coachRing(lon, lat, hdg, 1.5 + grow, L / 2, front, rear)] } });
            }
          }
          (map.getSource('rakes') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: rakes } as never);
          (map.getSource('heads') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: heads } as never);
          (map.getSource('beams') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: beams } as never);

          if (c.mode !== 'metro' && c.routes.length) {
            // Every route at 4 Hz: the dots, the count, and which routes are close enough to the view to need per-frame models.
            if (now - c.simAt > BUS_SIM_MS) {
              c.simAt = now;
              const one = c.route !== null ? c.byId.get(c.route) : undefined;
              const all = (c.simAll = simBuses(one ? [one] : c.routes, c.clock));
              c.simN = all.length;
              const near = new Set<number>();
              if (zoom >= 15) { const p = 0.012; for (const x of all) if (x.lon > b.getWest() - p && x.lon < b.getEast() + p && x.lat > b.getSouth() - p && x.lat < b.getNorth() + p) near.add(x.rid); }
              c.viewRoutes = [...near].map((id) => c.byId.get(id)!);
              (map.getSource('buses') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: all.map((x) => ({ type: 'Feature', properties: { id: x.id, rid: x.rid }, geometry: { type: 'Point', coordinates: [x.lon, x.lat] } })) } as never);
            }
            // Per frame: only the routes near the view (zoom >= 15) and the tracked bus's route.
            const selRoute = c.selBusId ? c.byId.get(+c.selBusId.split('-')[1]) : undefined;
            const need = zoom >= 15 ? (selRoute && !c.viewRoutes.includes(selRoute) ? [...c.viewRoutes, selRoute] : c.viewRoutes) : selRoute ? [selRoute] : [];
            // Heading eases towards the timetable's so buses swing round corners instead of snapping.
            const hdOf = (id: string, target: number) => {
              const h = c.hd.get(id) ?? target, n = (h + wrap(target - h) * (1 - Math.exp(-dt * 6)) + 360) % 360;
              c.hd.set(id, n);
              return n;
            };
            lastFresh = simBuses(need, c.clock).filter((x) => c.route === null || x.rid === c.route).map((x) => toView(x, hdOf(x.id, x.heading)));
            if (c.hd.size > 20000) c.hd.clear();
            const models: unknown[] = [];
            if (zoom >= 15) for (const v of lastFresh) if (seen(v)) models.push(...busParts(v, v.id === c.selBusId), { type: 'Feature', properties: { part: 'label', route: v.route }, geometry: { type: 'Point', coordinates: [v.lon, v.lat] } });
            (map.getSource('bus3d') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: models } as never);
          }

          const st = trains.find((t) => t.id === c.selId);
          if (c.selId && !st) { c.selId = null; c.following = false; }
          if (st && c.following && c.cam !== 'free') {
            const li = idx[st.line];
            const ahead = c.cam === 'cockpit' ? 30 : c.cam === 'chase' ? -66 : 0; // look-at point along the rake
            const [clon, clat] = sim.posAt(li, st.chainage + st.dir * ahead);
            const target: [number, number] = sideOf(clon, clat, canon(st), lateralAt(st, st.chainage + st.dir * ahead));
            const tb = c.cam === 'top' ? 0 : c.cam === 'orbit' ? (c.orbit = (c.orbit + 8 * dt) % 360) : st.bearing;
            steer(target, tb, PRESET[c.cam], dt, now, zoom);
          }
          const sb = c.selBusId ? lastFresh.find((v) => v.id === c.selBusId) : undefined;
          if (c.selBusId && c.routes.length && !sb && c.mode !== 'metro') { c.selBusId = null; c.following = false; } // its trip ended
          if (sb && c.following && c.cam !== 'free') {
            const ahead = c.cam === 'cockpit' ? 8 : c.cam === 'chase' ? -20 : 0; // look-at point along the bus, metres
            const target = frame(sb.lon, sb.lat, sb.heading)(ahead, 0);
            const tb = c.cam === 'top' ? 0 : c.cam === 'orbit' ? (c.orbit = (c.orbit + 8 * dt) % 360) : sb.heading;
            steer(target, tb, BUS_PRESET[c.cam], dt, now, zoom);
          }
          if (now - lastUi > 250) { // React state at 4 Hz
            lastUi = now;
            setClock(fmt(c.clock));
            setSimN(c.simN);
            setSel(st ?? null);
            c.drawHL?.();
            if (sb) {
              setSelBus({ ...sb, age: '' });
            } else setSelBus(null);
            if (c.prompt && !c.selId) {
              // keep a valid random suggestion: running, above ground, not mid-turnback
              let pick = trains.find((x) => x.id === c.suggestId);
              if (!pick || pick.underground) {
                const pool = trains.filter((x) => x.state === 'running' && !x.underground && !x.turnback && x.id !== c.suggestId);
                pick = pool[Math.floor(Math.random() * pool.length)];
                c.suggestId = pick?.id ?? null;
              }
              setSuggest(pick ?? null);
            }
            const n: Record<string, number> = {};
            for (const t of trains) n[t.line] = (n[t.line] ?? 0) + 1;
            setCounts(n);
            const f = c.theme === 'day' ? 0 : c.theme === 'night' ? 1 : nightFactor(c.clock);
            if (Math.abs(f - lastF) > 0.01) { lastF = f; applyTheme(f); setNight(f > 0.5); }
          }
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      c.applyMode?.(c.mode);
    });

    return () => { cancelAnimationFrame(raf); cleanup.forEach((f) => f()); map.remove(); c.map = null; };
  }, [net, sim]);

  const selLine = sel && net ? net.lines.find((l) => l.id === sel.line) : null;
  return (
    <div className="relative h-screen w-screen overflow-hidden">
      {/* inline style: maplibre.css sets position:relative, which would collapse the height */}
      <div ref={el} style={{ position: 'absolute', inset: 0 }} />
      {net && <Header net={net} onPick={(lon, lat) => { ctl.current.following = false; ctl.current.map?.flyTo({ center: [lon, lat], zoom: 16.5, pitch: 55, duration: 1800 }); }} />}
      <div className="glass absolute left-2 top-[4.6rem] flex gap-1 p-1 text-xs sm:left-1/2 sm:top-4 sm:-translate-x-1/2">
        {MODES.map(([m, label]) => (
          <button key={m} onClick={() => setMode(m)} aria-pressed={mode === m} className={`rounded-md px-2.5 py-1.5 ${mode === m ? 'bg-white/20' : 'bg-white/5 hover:bg-white/10'}`}>{label}</button>
        ))}
        {mode !== 'metro' && <span className="flex items-center gap-1.5 px-1.5 text-white/60"><i className={`h-2 w-2 rounded-full ${busState === 'error' ? 'bg-red-400' : busState === 'ready' ? 'bg-amber-400' : 'bg-white/40'}`} />{busState === 'ready' ? `${simN.toLocaleString('en-IN')} buses` : busState === 'error' ? 'Bus data failed to load' : 'Loading buses…'}</span>}
      </div>
      {mode !== 'metro' && <BusSearch index={busIndex} active={activeRoute} onPick={(id) => ctl.current.setRoute?.(id)} onClear={() => ctl.current.setRoute?.(null)} />}
      <ClockBar clock={clock} speed={speed} setSpeed={setSpeed} jump={jump} counts={counts} theme={theme} setTheme={setTheme} night={night} />
      {promptOpen && !sel && suggest && net && <TrackPrompt t={suggest} line={net.lines.find((l) => l.id === suggest.line)!} onStart={() => ctl.current.track?.(suggest.id)} onShuffle={shuffle} onDismiss={dismissPrompt} />}
      {!promptOpen && !sel && !selBus && mode !== 'bus' && <TrackHint onRandom={shuffle} />}
      {mode === 'bus' && !selBus && <div className="glass absolute bottom-2 left-2 px-4 py-2 text-xs text-white/70 sm:bottom-4 sm:left-4">Zoom in and tap any bus to track it</div>}
      {selBus && mode !== 'metro' && !sel && <BusCard b={selBus} cam={cam} setCam={setCam} close={closeBus} />}
      {sel && selLine && <TrainCard t={sel} line={selLine} cam={cam} setCam={setCam} close={close} />}
      {sel && selLine && <LineStrip line={selLine} t={sel} />}
      {net && !sel && mode !== 'bus' && (
        <div className="glass absolute bottom-2 left-2 flex max-w-[calc(100vw-4.5rem)] flex-wrap gap-x-4 gap-y-1 px-4 py-3 text-xs sm:bottom-4 sm:left-4">
          {net.lines.map((l) => (
            <span key={l.id} className="flex items-center gap-2" style={{ opacity: l.open ? 1 : 0.6 }}>
              <i className="inline-block h-2.5 w-5 rounded-full" style={{ background: l.color }} />
              {l.name}
              {!l.open && <em className="not-italic text-white/50">(upcoming)</em>}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
