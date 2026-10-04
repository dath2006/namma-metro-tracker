'use client';

import { useMemo, useState } from 'react';
import type { Line, Network } from '@/lib/network';
import type { TrainState } from '@/lib/engine';

export type CamMode = 'chase' | 'cockpit' | 'top' | 'orbit' | 'free';
export type Theme = 'auto' | 'day' | 'night';

const CAMS: { id: CamMode; label: string; hint: string }[] = [
  { id: 'chase', label: 'Chase', hint: 'Behind and above the rake' },
  { id: 'cockpit', label: 'Cockpit', hint: "Driver's eye view" },
  { id: 'top', label: 'Top', hint: 'Straight down, north up' },
  { id: 'orbit', label: 'Orbit', hint: 'Slow circle around the train' },
  { id: 'free', label: 'Free', hint: 'Stop following' },
];

export function Header({ net, onPick }: { net: Network; onPick: (lon: number, lat: number) => void }) {
  const [q, setQ] = useState('');
  const hits = useMemo(() => {
    if (q.length < 2) return [];
    const s = q.toLowerCase();
    return net.lines.flatMap((l) => l.stations.filter((x) => x.name.toLowerCase().includes(s)).map((x) => ({ ...x, line: l }))).slice(0, 7);
  }, [q, net]);
  return (
    <div className="absolute left-2 top-2 w-[calc(100vw-1rem)] sm:left-4 sm:top-4 sm:w-[22rem]">
      <header className="glass flex items-center gap-3 px-3 py-2.5">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-purple-600 text-lg">Ⓜ</div>
        <div className="shrink-0 leading-tight">
          <div className="text-sm font-semibold">Namma Metro</div>
          <div className="text-xs text-white/60">Timetable simulation</div>
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search station…"
          className="ml-1 min-w-0 flex-1 rounded-lg bg-white/5 px-3 py-2 text-sm outline-none placeholder:text-white/40 focus:bg-white/10"
        />
      </header>
      {hits.length > 0 && (
        <ul className="glass mt-2 overflow-hidden py-1 text-sm">
          {hits.map((h) => (
            <li key={h.code + h.line.id}>
              <button className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-white/10" onClick={() => { onPick(h.lon, h.lat); setQ(''); }}>
                <i className="h-2.5 w-2.5 rounded-full" style={{ background: h.line.color }} />
                {h.name}
                {!h.line.open && <em className="ml-auto text-xs not-italic text-white/40">upcoming</em>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ClockBar({ clock, speed, setSpeed, jump, counts, theme, setTheme, night }: {
  clock: string; speed: number; setSpeed: (n: number) => void; jump: (h: number) => void; counts: Record<string, number>;
  theme: Theme; setTheme: (t: Theme) => void; night: boolean;
}) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const btn = (active: boolean) => `rounded-md px-2 py-1 text-xs ${active ? 'bg-white/20' : 'bg-white/5 hover:bg-white/10'}`;
  const next: Record<Theme, Theme> = { auto: 'day', day: 'night', night: 'auto' };
  return (
    <div className="glass absolute right-2 top-[4.6rem] px-3 py-2 text-right sm:right-4 sm:top-4 sm:px-4 sm:py-3">
      <div className="text-lg font-semibold tabular-nums">{clock}</div>
      <div className="flex items-center justify-end gap-1.5 text-xs text-white/70">
        <i className={`h-2 w-2 rounded-full ${speed === 1 ? 'bg-emerald-400' : 'bg-amber-400'}`} />
        {speed === 1 ? 'Real time' : `Fast-forward ×${speed}`} · {total} trains
      </div>
      <div className="mt-2 flex flex-wrap justify-end gap-1">
        {[1, 10, 60].map((s) => <button key={s} onClick={() => setSpeed(s)} className={btn(speed === s)}>{s === 1 ? '1×' : `×${s}`}</button>)}
        <button onClick={() => jump(9)} className={btn(false)}>9 AM</button>
        <button onClick={() => jump(18)} className={btn(false)}>6 PM</button>
        <button onClick={() => jump(21)} className={btn(false)}>9 PM</button>
        <button onClick={() => jump(-1)} className={btn(false)}>Now</button>
        <button onClick={() => setTheme(next[theme])} title="Day / night" className={btn(false)}>
          {theme === 'auto' ? 'Auto ' : ''}{night ? '🌙' : '☀️'}
        </button>
      </div>
      <div className="mt-1.5 hidden justify-end gap-2 text-[11px] text-white/60 sm:flex">
        {Object.entries(counts).map(([id, n]) => <span key={id}>{id[0].toUpperCase() + id.slice(1)} {n}</span>)}
      </div>
    </div>
  );
}

type Tone = 'go' | 'warn' | 'info' | 'idle';
const TONE: Record<Tone, string> = {
  go: 'bg-emerald-500/20 text-emerald-300',
  warn: 'bg-amber-500/20 text-amber-300',
  info: 'bg-sky-500/20 text-sky-300',
  idle: 'bg-white/10 text-white/70',
};
const short = (n: string) => n.split(' (')[0];

/** One-line status for a train: door cycle at a platform, otherwise what it is doing and where it is going. */
export function statusOf(t: TrainState): { text: string; tone: Tone } {
  if (t.doors === 'opening') return { text: 'Doors opening', tone: 'warn' };
  if (t.doors === 'open') return { text: 'Doors open · boarding', tone: 'go' };
  if (t.doors === 'closing') return { text: 'Doors closing · stand clear', tone: 'warn' };
  switch (t.phase) {
    case 'arriving': return { text: `Arriving at ${short(t.next)} · ${Math.ceil(t.etaSec)}s`, tone: 'info' };
    case 'departing': return { text: 'Departing', tone: 'info' };
    case 'to-tail': return { text: 'Pulling onto the tail track', tone: 'idle' };
    case 'parked': return { text: 'Waiting on the tail track', tone: 'idle' };
    case 'from-tail': return { text: 'Reversing to the platform', tone: 'idle' };
    default: return { text: 'In service · doors closed', tone: 'idle' };
  }
}

/** Shown on arrival: a randomly chosen running train the visitor can start tracking with one tap. */
export function TrackPrompt({ t, line, onStart, onShuffle, onDismiss }: { t: TrainState; line: Line; onStart: () => void; onShuffle: () => void; onDismiss: () => void }) {
  const kmh = Math.round(t.speed * 3.6);
  const st = statusOf(t);
  return (
    <div className="glass absolute bottom-2 left-2 right-16 p-4 sm:bottom-4 sm:left-1/2 sm:right-auto sm:w-[26rem] sm:-translate-x-1/2">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-wide text-white/50">Track a train live</div>
          <div className="mt-2 flex items-center gap-2">
            <span className="rounded-md px-2 py-0.5 text-xs font-semibold" style={{ background: t.color }}>{line.name}</span>
            <span className="truncate text-sm font-semibold">to {short(t.headingTo)}</span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-white/70">
            <span>{t.id}</span>
            <span className={`rounded-md px-2 py-0.5 font-semibold ${kmh ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/10'}`}>{kmh ? `${kmh} km/h` : 'At platform'}</span>
            <span className={`rounded-md px-2 py-0.5 ${TONE[st.tone]}`}>{st.text}</span>
          </div>
        </div>
        <button onClick={onDismiss} aria-label="Dismiss" className="text-white/50 hover:text-white">✕</button>
      </div>
      <div className="mt-3 flex gap-2">
        <button onClick={onStart} className="flex-1 rounded-lg bg-purple-600 px-3 py-2 text-sm font-semibold hover:bg-purple-500">Start tracking</button>
        <button onClick={onShuffle} className="rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/15">Another train</button>
      </div>
    </div>
  );
}

/** Small reminder once the prompt is dismissed and nothing is being tracked. */
export function TrackHint({ onRandom }: { onRandom: () => void }) {
  return (
    <div className="glass absolute bottom-16 left-2 flex items-center gap-3 px-4 py-2 text-xs text-white/70 sm:bottom-4 sm:left-1/2 sm:-translate-x-1/2">
      Tap any train to track it
      <button onClick={onRandom} className="rounded-md bg-white/10 px-2 py-1 text-white hover:bg-white/15">Track a random train</button>
    </div>
  );
}

export function TrainCard({ t, line, cam, setCam, close }: { t: TrainState; line: Line; cam: CamMode; setCam: (c: CamMode) => void; close: () => void }) {
  const kmh = Math.round(t.speed * 3.6);
  const mins = Math.ceil(t.etaSec / 60);
  const st = statusOf(t);
  return (
    <div className="glass absolute bottom-2 left-2 right-16 p-4 sm:bottom-auto sm:left-auto sm:right-4 sm:top-48 sm:w-[21rem]">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl text-lg" style={{ background: t.color + '33' }}>🚆</div>
        <div className="min-w-0 flex-1">
          <span className="rounded-md px-2 py-0.5 text-xs font-semibold" style={{ background: t.color }}>{line.name}</span>
          <div className="mt-1 truncate font-semibold">Train to {t.headingTo}</div>
          <div className="mt-1 flex items-center gap-2 text-sm text-white/70">
            {t.coaches} Coaches
            <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${kmh ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/10 text-white/70'}`}>
              {kmh ? `${kmh} km/h` : 'At platform'}
            </span>
            {t.underground && <span className="rounded-md bg-sky-500/20 px-2 py-0.5 text-xs text-sky-300">In tunnel</span>}
          </div>
          <div className={`mt-2 inline-block rounded-md px-2 py-1 text-xs font-semibold ${TONE[st.tone]}`}>{st.text}</div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-emerald-400 transition-[width] duration-300" style={{ width: `${Math.min(100, (t.speed / (80 / 3.6)) * 100)}%` }} />
          </div>
        </div>
        <button onClick={close} aria-label="Close" className="text-white/50 hover:text-white">✕</button>
      </div>
      <div className="mt-3 flex items-end justify-between border-t border-white/10 pt-3">
        <div>
          <div className="text-xs text-white/50">{t.state === 'dwelling' ? 'Now at' : 'Next stop'}</div>
          <div className="font-semibold">{t.next}</div>
        </div>
        <div className="shrink-0 pl-2 text-sm text-white/70">{t.state === 'dwelling' ? 'Boarding' : mins <= 1 ? 'Arriving' : `~ ${mins} min`}</div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 text-xs text-white/50">
        <span className="shrink-0">{t.id}</span>
        <div className="flex gap-1">
          {CAMS.map((c) => (
            <button key={c.id} title={c.hint} onClick={() => setCam(c.id)} className={`rounded-md px-2 py-1 ${cam === c.id ? 'bg-white/20 text-white' : 'bg-white/5 hover:bg-white/10'}`}>{c.label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function LineStrip({ line, t }: { line: Line; t: TrainState }) {
  const frac = (m: number) => `${(Math.min(Math.max(m, 0), line.length) / line.length) * 100}%`;
  const last = line.stations.length - 1;
  // label only terminals and the stop the train is heading to, to stay legible on 37 stations
  const labelled = new Set([0, last, line.stations.findIndex((s) => s.name === t.next)]);
  return (
    <div className="glass absolute bottom-4 left-4 hidden w-[min(36rem,calc(100vw-2rem))] px-5 pb-8 pt-4 sm:block">
      <div className="mb-4 text-sm font-semibold">{line.name}</div>
      <div className="relative mx-3 h-1 rounded-full bg-white/15">
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: frac(t.chainage), background: line.color }} />
        {line.stations.map((s, i) => (
          <span key={s.code} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: frac(s.at) }}>
            <i className="block h-2 w-2 rounded-full ring-1 ring-black/40" style={{ background: s.at < t.chainage ? line.color : '#8b8fa3' }} />
            {labelled.has(i) && <span className="absolute left-1/2 top-3 -translate-x-1/2 whitespace-nowrap text-[11px] text-white/70">{s.name.split(' (')[0]}</span>}
          </span>
        ))}
        <span className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white" style={{ left: frac(t.chainage), background: line.color }} />
      </div>
    </div>
  );
}
