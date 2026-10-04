'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Line, Network } from '@/lib/network';
import { createSim, lateralAt, RAKE_LEN, setTrackOffset } from '@/lib/engine';
import { applyOverrides, buildPath, DEFAULT_TRACK_OFFSET, sparse, vertexOffsets, type LineOverride, type Overrides } from '@/lib/overrides';
import { cumOf, mPerDeg, satStyle, sideOf } from '@/lib/geo';

maplibregl.setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');

type Drag = { l: Line; v: [number, number][]; shift: [number, number]; gi: number; cum: number[]; start: maplibregl.LngLat; nv: [number, number][] };
const fc = (features: unknown[]) => ({ type: 'FeatureCollection', features }) as never;
const line = (coordinates: number[][], properties: Record<string, unknown> = {}) => ({ type: 'Feature', properties, geometry: { type: 'LineString', coordinates } });

/** The two rails trains will run on: the centreline pushed `m` metres to each side. */
function rails(path: [number, number][], m: number) {
  const side = (sgn: number) => path.map(([x, y], i) => {
    const a = path[Math.max(i - 1, 0)], b = path[Math.min(i + 1, path.length - 1)];
    const { kx, ky } = mPerDeg(y);
    const bearing = (Math.atan2((b[0] - a[0]) * kx, (b[1] - a[1]) * ky) * 180) / Math.PI;
    return sideOf(x, y, bearing, sgn * m);
  });
  return [side(1), side(-1)];
}

const btn = 'rounded-md bg-white/10 px-2.5 py-1.5 text-xs hover:bg-white/20 disabled:opacity-30 disabled:hover:bg-white/10';

export default function Aligner({ onLogout }: { onLogout: () => void }) {
  const el = useRef<HTMLDivElement>(null);
  const [net, setNet] = useState<Network | null>(null);
  const [ov, setOv] = useState<Overrides>({});
  const [lineId, setLineId] = useState('purple');
  const [radius, setRadius] = useState(120);
  const [offset, setOffset] = useState(DEFAULT_TRACK_OFFSET);
  const [showOrig, setShowOrig] = useState(true);
  const [showTrains, setShowTrains] = useState(true);
  const [step, setStep] = useState(1);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState('');
  const [ready, setReady] = useState(false);
  const [clockText, setClockText] = useState('');
  const hist = useRef<{ past: Overrides[]; future: Overrides[] }>({ past: [], future: [] });
  const [depth, setDepth] = useState({ undo: 0, redo: 0 }); // mirrors hist so the buttons can enable/disable
  const syncDepth = () => setDepth({ undo: hist.current.past.length, redo: hist.current.future.length });
  const clk = useRef(0); // ms offset applied to the real clock, for the 9 AM / 6 PM previews
  const map = useRef<maplibregl.Map | null>(null);
  // Latest values for map event handlers, which are registered once.
  const live = useRef({ net: null as Network | null, ov: {} as Overrides, lineId, radius, offset, showOrig, drag: null as Drag | null });

  useEffect(() => {
    Promise.all([fetch('/data/network.json').then((r) => r.json()), fetch('/api/overrides').then((r) => r.json())]).then(([n, o]) => {
      setNet(n);
      setOv(o ?? {});
      setOffset((o as Overrides)?.trackOffset ?? DEFAULT_TRACK_OFFSET);
    });
  }, []);
  useEffect(() => { live.current = { ...live.current, net, ov, lineId, radius, offset, showOrig }; });

  const current = net?.lines.find((l) => l.id === lineId) ?? null;
  const corrected = useMemo(() => (net ? applyOverrides(net, ov) : null), [net, ov]);
  const sim = useMemo(() => { if (!corrected) return null; setTrackOffset(offset); return createSim(corrected); }, [corrected, offset]);

  /** Push geometry for the selected line (optionally a live drag draft) to the map. */
  const paint = useCallback((draft?: { l: Line; nv: [number, number][]; shift: [number, number] }) => {
    const m = map.current, s = live.current;
    if (!m || !s.net || !m.getSource('cur')) return;
    const all = applyOverrides(s.net, s.ov).lines;
    const l = s.net.lines.find((x) => x.id === s.lineId)!;
    const o: LineOverride = s.ov.lines?.[l.id] ?? {};
    const path = draft ? buildPath(draft.l.path, draft.nv, draft.shift) : buildPath(l.path, vertexOffsets(l.path.length, o), o.shift);
    const [r1, r2] = rails(path, s.offset);
    (m.getSource('cur') as maplibregl.GeoJSONSource).setData(fc([line(path)]));
    (m.getSource('rails') as maplibregl.GeoJSONSource).setData(fc([line(r1), line(r2)]));
    (m.getSource('orig') as maplibregl.GeoJSONSource).setData(fc(s.showOrig ? [line(l.path)] : []));
    (m.getSource('others') as maplibregl.GeoJSONSource).setData(fc(all.filter((x) => x.id !== l.id).map((x) => line(x.path, { color: x.color }))));
    (m.getSource('stations') as maplibregl.GeoJSONSource).setData(fc(all.flatMap((x) => x.stations.map((st) => ({ type: 'Feature', properties: { name: st.name }, geometry: { type: 'Point', coordinates: [st.lon, st.lat] } })))));
  }, []);

  // ---- map ----
  useEffect(() => {
    if (!el.current || !net) return;
    const m = new maplibregl.Map({ container: el.current, style: satStyle(), center: [77.5946, 12.9716], zoom: 12.5, maxPitch: 60, attributionControl: { compact: true } });
    map.current = m;
    m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
    m.once('style.load', () => {
      for (const id of ['cur', 'rails', 'orig', 'others', 'stations', 'rakes', 'heads']) m.addSource(id, { type: 'geojson', data: fc([]) });
      m.addLayer({ id: 'others', type: 'line', source: 'others', paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-opacity': 0.55 } });
      m.addLayer({ id: 'orig', type: 'line', source: 'orig', paint: { 'line-color': '#ffffff', 'line-width': 1.2, 'line-opacity': 0.6, 'line-dasharray': [2, 2] } });
      m.addLayer({ id: 'cur-hit', type: 'line', source: 'cur', paint: { 'line-color': '#000', 'line-width': 26, 'line-opacity': 0 } });
      m.addLayer({ id: 'cur', type: 'line', source: 'cur', paint: { 'line-color': '#ffd84a', 'line-width': 2.2, 'line-opacity': 0.95 } });
      m.addLayer({ id: 'rails', type: 'line', source: 'rails', paint: { 'line-color': '#31e1ff', 'line-width': 1.6 } });
      m.addLayer({ id: 'stations', type: 'circle', source: 'stations', paint: { 'circle-radius': 3, 'circle-color': '#fff', 'circle-stroke-color': '#000', 'circle-stroke-width': 1 } });
      m.addLayer({ id: 'station-labels', type: 'symbol', source: 'stations', minzoom: 14, layout: { 'text-field': ['get', 'name'], 'text-font': ['Open Sans Regular,Arial Unicode MS Regular'], 'text-size': 11, 'text-offset': [0, 1], 'text-anchor': 'top', 'text-optional': true }, paint: { 'text-color': '#fff', 'text-halo-color': 'rgba(0,0,0,.85)', 'text-halo-width': 1.4 } });
      m.addLayer({ id: 'rakes-casing', type: 'line', source: 'rakes', layout: { 'line-cap': 'butt' }, paint: { 'line-color': '#fff', 'line-width': 8 } });
      m.addLayer({ id: 'rakes', type: 'line', source: 'rakes', layout: { 'line-cap': 'butt' }, paint: { 'line-color': ['get', 'color'], 'line-width': 5.5 } });
      m.addLayer({ id: 'heads', type: 'circle', source: 'heads', paint: { 'circle-radius': 4, 'circle-color': '#fff', 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 2 } });

      m.on('mouseenter', 'cur-hit', () => { if (!live.current.drag) m.getCanvas().style.cursor = 'grab'; });
      m.on('mouseleave', 'cur-hit', () => { if (!live.current.drag) m.getCanvas().style.cursor = ''; });
      m.on('mousedown', 'cur-hit', (e) => {
        const s = live.current, l = s.net?.lines.find((x) => x.id === s.lineId);
        if (!l || e.originalEvent.button !== 0) return;
        const o: LineOverride = s.ov.lines?.[l.id] ?? {};
        const v = vertexOffsets(l.path.length, o), shift = o.shift ?? [0, 0];
        const path = buildPath(l.path, v, shift), { kx, ky } = mPerDeg(e.lngLat.lat);
        let gi = 0, best = Infinity;
        path.forEach(([x, y], i) => { const d = ((x - e.lngLat.lng) * kx) ** 2 + ((y - e.lngLat.lat) * ky) ** 2; if (d < best) { best = d; gi = i; } });
        s.drag = { l, v, shift, gi, cum: cumOf(l.path), start: e.lngLat, nv: v };
        m.dragPan.disable();
        m.getCanvas().style.cursor = 'grabbing';
        e.preventDefault();
      });
      m.on('mousemove', (e) => {
        const d = live.current.drag;
        if (!d) return;
        const { kx, ky } = mPerDeg(e.lngLat.lat), dx = (e.lngLat.lng - d.start.lng) * kx, dy = (e.lngLat.lat - d.start.lat) * ky, R = live.current.radius;
        // grab a point and the stretch of track around it follows, tapering to nothing at `radius` metres either side
        d.nv = d.v.map(([x, y], i) => {
          const dist = Math.abs(d.cum[i] - d.cum[d.gi]);
          if (dist >= R) return [x, y];
          const t = 1 - dist / R, w = t * t * (3 - 2 * t);
          return [x + w * dx, y + w * dy];
        });
        paint({ l: d.l, nv: d.nv, shift: d.shift });
      });
      const end = () => {
        const d = live.current.drag;
        if (!d) return;
        live.current.drag = null;
        m.dragPan.enable();
        m.getCanvas().style.cursor = '';
        const prev = live.current.ov;
        hist.current.past.push(prev);
        hist.current.future = [];
        syncDepth();
        const lines = { ...prev.lines, [d.l.id]: { ...prev.lines?.[d.l.id], offsets: sparse(d.nv) } };
        setOv({ ...prev, lines });
        setDirty(true);
      };
      m.on('mouseup', end);
      window.addEventListener('mouseup', end);
      setReady(true);
    });
    return () => { setReady(false); map.current = null; m.remove(); };
  }, [net, paint]);

  useEffect(() => { if (ready) paint(); }, [ready, ov, lineId, offset, showOrig, paint]);

  // ---- live train preview, so you can see the rake sit on the rails ----
  useEffect(() => {
    const m = map.current;
    if (!ready || !m || !sim || !corrected) return;
    const idx = Object.fromEntries(corrected.lines.map((l, i) => [l.id, i]));
    let raf = 0, last = 0, lastText = 0;
    const tick = (now: number) => {
      if (now - last > 50) {
        last = now;
        const t0 = Date.now() + clk.current;
        const rakes: unknown[] = [], heads: unknown[] = [];
        if (showTrains)
          for (const t of sim.getTrains(t0)) {
            if (t.underground) continue;
            const li = idx[t.line];
            const pts = Array.from({ length: 9 }, (_, k) => {
              const s = t.chainage - t.dir * (k / 8) * RAKE_LEN;
              const [lon, lat, b] = sim.posAt(li, s);
              return sideOf(lon, lat, b, lateralAt(t, s));
            });
            rakes.push(line(pts, { color: t.color }));
            heads.push({ type: 'Feature', properties: { color: t.color }, geometry: { type: 'Point', coordinates: pts[0] } });
          }
        (m.getSource('rakes') as maplibregl.GeoJSONSource)?.setData(fc(rakes));
        (m.getSource('heads') as maplibregl.GeoJSONSource)?.setData(fc(heads));
        if (now - lastText > 1000) {
          lastText = now;
          setClockText(new Date(t0).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true }));
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ready, sim, corrected, showTrains]);

  // ---- edits ----
  const commit = useCallback((next: Overrides) => {
    hist.current.past.push(live.current.ov);
    hist.current.future = [];
    syncDepth();
    setOv(next);
    setDirty(true);
  }, []);
  const undo = useCallback(() => { const p = hist.current.past.pop(); if (p) { hist.current.future.push(live.current.ov); syncDepth(); setOv(p); setDirty(true); } }, []);
  const redo = useCallback(() => { const f = hist.current.future.pop(); if (f) { hist.current.past.push(live.current.ov); syncDepth(); setOv(f); setDirty(true); } }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || (e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 'z') { e.preventDefault(); undo(); } else if (e.key === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [undo, redo]);

  const lineOv: LineOverride = ov.lines?.[lineId] ?? {};
  const shift = lineOv.shift ?? [0, 0];
  const nudge = (dx: number, dy: number) => commit({ ...ov, lines: { ...ov.lines, [lineId]: { ...lineOv, shift: [Math.round((shift[0] + dx) * 100) / 100, Math.round((shift[1] + dy) * 100) / 100] } } });
  const resetLine = () => { const lines = { ...ov.lines }; delete lines[lineId]; commit({ ...ov, lines }); };
  const setOff = (v: number) => { setOffset(v); setDirty(true); setOv((o) => ({ ...o, trackOffset: v })); };

  const save = async () => {
    setMsg('Saving…');
    const body: Overrides = { ...ov, trackOffset: offset };
    const r = await fetch('/api/admin/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (r.ok) { setDirty(false); setMsg('Saved. Reload the tracker to see it.'); } else setMsg(r.status === 401 ? 'Session expired. Sign in again.' : 'Save failed.');
  };
  const logout = async () => { await fetch('/api/admin/login', { method: 'DELETE' }); onLogout(); };
  const jump = (h: number) => {
    if (h < 0) { clk.current = 0; return; }
    const ist = new Date(Date.now() + 5.5 * 3600e3);
    clk.current = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), h) - 5.5 * 3600e3 - Date.now();
  };
  const goStation = (code: string) => {
    const st = corrected?.lines.find((l) => l.id === lineId)?.stations.find((s) => s.code === code);
    if (st) map.current?.flyTo({ center: [st.lon, st.lat], zoom: 18.6, pitch: 0, bearing: 0, duration: 1200 });
  };

  const modified = Object.keys(lineOv.offsets ?? {}).length > 0 || shift[0] !== 0 || shift[1] !== 0;
  return (
    <div className="relative h-screen w-screen overflow-hidden">
      <div ref={el} style={{ position: 'absolute', inset: 0 }} />
      <aside className="glass absolute left-3 top-3 max-h-[calc(100vh-1.5rem)] w-80 space-y-4 overflow-y-auto p-4 text-sm">
        <div className="flex items-center justify-between">
          <div className="font-semibold">Track aligner</div>
          <button onClick={logout} className={btn}>Sign out</button>
        </div>
        <p className="text-xs leading-relaxed text-white/60">
          Drag the <b className="text-yellow-300">yellow centreline</b> so the <b className="text-cyan-300">cyan rails</b> sit on the real tracks. Trains run on the cyan rails. The dashed white line is the original, unedited route.
        </p>

        <div className="flex flex-wrap gap-1.5">
          {net?.lines.map((l) => (
            <button key={l.id} onClick={() => setLineId(l.id)} className={`rounded-md px-2.5 py-1.5 text-xs font-semibold ${l.id === lineId ? 'text-black' : 'bg-white/10'}`} style={l.id === lineId ? { background: l.color } : undefined}>
              {l.name.replace(' Line', '')}
            </button>
          ))}
        </div>

        <label className="block text-xs text-white/70">
          Drag reach: {radius} m each side
          <input type="range" min={20} max={400} step={10} value={radius} onChange={(e) => setRadius(+e.target.value)} className="mt-1 w-full" />
        </label>
        <label className="block text-xs text-white/70">
          Centreline to each rail: {offset.toFixed(1)} m
          <input type="range" min={0.5} max={6} step={0.1} value={offset} onChange={(e) => setOff(+e.target.value)} className="mt-1 w-full" />
        </label>

        <div className="text-xs text-white/70">
          Nudge the whole {current?.name ?? 'line'} ({shift[0].toFixed(1)} m E, {shift[1].toFixed(1)} m N)
          <div className="mt-1.5 flex items-center gap-1.5">
            <select value={step} onChange={(e) => setStep(+e.target.value)} className="rounded-md bg-white/10 px-1.5 py-1.5 text-xs">
              {[0.25, 0.5, 1, 2, 5, 10].map((s) => <option key={s} value={s} className="text-black">{s} m</option>)}
            </select>
            <button className={btn} onClick={() => nudge(-step, 0)}>← W</button>
            <button className={btn} onClick={() => nudge(0, step)}>↑ N</button>
            <button className={btn} onClick={() => nudge(0, -step)}>↓ S</button>
            <button className={btn} onClick={() => nudge(step, 0)}>E →</button>
          </div>
        </div>

        <div className="space-y-1.5 text-xs">
          <label className="flex items-center gap-2"><input type="checkbox" checked={showTrains} onChange={(e) => setShowTrains(e.target.checked)} /> Show trains ({clockText})</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={showOrig} onChange={(e) => setShowOrig(e.target.checked)} /> Show original route</label>
          <div className="flex gap-1.5 pt-1">
            <button className={btn} onClick={() => jump(-1)}>Now</button>
            <button className={btn} onClick={() => jump(9)}>9 AM</button>
            <button className={btn} onClick={() => jump(18)}>6 PM</button>
          </div>
        </div>

        <select defaultValue="" onChange={(e) => e.target.value && goStation(e.target.value)} className="w-full rounded-md bg-white/10 px-2 py-2 text-xs">
          <option value="" className="text-black">Jump to a station…</option>
          {current?.stations.map((s) => <option key={s.code} value={s.code} className="text-black">{s.name}</option>)}
        </select>

        <div className="flex flex-wrap gap-1.5 border-t border-white/10 pt-3">
          <button className={btn} onClick={undo} disabled={!depth.undo}>Undo</button>
          <button className={btn} onClick={redo} disabled={!depth.redo}>Redo</button>
          <button className={btn} onClick={resetLine} disabled={!modified}>Reset this line</button>
        </div>
        <button onClick={save} disabled={!dirty} className="w-full rounded-lg bg-purple-600 px-3 py-2 text-sm font-semibold hover:bg-purple-500 disabled:opacity-40">
          {dirty ? 'Save changes' : 'No unsaved changes'}
        </button>
        {msg && <div className="text-xs text-white/70">{msg}</div>}
      </aside>
    </div>
  );
}
