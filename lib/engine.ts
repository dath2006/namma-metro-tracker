// Schedule-driven train simulation: pure function of (network, time). No state, no network, no randomness.
import type { Line, Network } from './network';

// ---- calibration knobs (tune against real-world observation) ----
export const CONFIG = {
  accel: 0.9, // m/s², service braking is symmetric
  topSpeed: 80 / 3.6, // m/s hard cap (BMRCL max operating speed)
  dwell: 30, // s at a normal station
  dwellInterchange: 45,
  dwellMajestic: 60,
  holdAtOrigin: 60, // s the rake is visible, stopped, before departure
  holdAtTerminus: 60, // s the rake stays on the platform at the last station
  coaches: 6,
  coachLen: 22, // m
  coachGap: 0.8, // m between coaches; with the above a 6-car rake is 136 m
  trackOffset: 2.5, // m, each direction runs on its own track, this far from the centreline (tunable in /admin)
  // Terminal turnback: after the platform the rake pulls ahead onto the tail track, waits, then reverses through a
  // crossover onto the opposite platform. Distances are in metres from the station centre, towards the line end.
  turnback: { tailHead: 230, xoverStart: 80, xoverEnd: 170, speed: 5.5, minWait: 30, tailHold: 30, maxWait: 2700 },
  // End-to-end running time targets in minutes (OSM/BMRCL route duration). Cruise speed is solved to match.
  targetMinutes: { purple: 80, green: 61, yellow: 40 } as Record<string, number>,
  // Seconds added to the clock, e.g. to line the simulation up with a real train you observed.
  timeOffset: 0,
};

type DayKey = 'monday' | 'weekday' | 'saturday' | 'sunday';
type Band = { start: string; end: string; headway: string };
type Timetable = {
  frequency: { from: string; toward: string; bands: Band[] }[];
  trips: { from: string; to: string; times: string[] }[];
};

type Leg = { seq: number[]; arr: number[]; dep: number[]; dist: number[]; vmax: number };
// out: when a terminating train leaves the tail track; ls: when a terminal departure starts rolling in from it.
type Trip = { key: string; line: number; dir: 1 | -1; i0: number; i1: number; t0: number; n: number; out?: number; ls?: number; from?: Trip };

export const setTrackOffset = (m: number) => { CONFIG.trackOffset = m; };

export const RAKE_LEN = CONFIG.coaches * CONFIG.coachLen + (CONFIG.coaches - 1) * CONFIG.coachGap;
const STOP = RAKE_LEN / 2; // the rake stops centred on the station: head is half a rake past the station point
const TB_DIST = CONFIG.turnback.tailHead - STOP; // head travel from platform to tail (and back)
const smooth = (u: number) => { u = Math.min(Math.max(u, 0), 1); return u * u * (3 - 2 * u); };

export type Doors = 'closed' | 'opening' | 'open' | 'closing';
export type Phase = 'cruising' | 'arriving' | 'departing' | 'dwell' | 'to-tail' | 'parked' | 'from-tail';
// Door cycle at a stop: opening for the first DOOR_OPEN_S, closing for the last DOOR_CLOSE_S, open in between.
const DOOR_OPEN_S = 3, DOOR_CLOSE_S = 5;
const doorsAt = (elapsed: number, total: number): Doors => (elapsed < DOOR_OPEN_S ? 'opening' : elapsed > total - DOOR_CLOSE_S ? 'closing' : 'open');

export type TrainState = {
  id: string;
  tripKey: string; // line|from|to|scheduled departure (s after midnight)
  line: string;
  color: string;
  dir: 1 | -1;
  headingTo: string; // final stop of this trip
  chainage: number; // m along the line's canonical path (head of the rake)
  speed: number; // m/s
  state: 'dwelling' | 'running';
  underground: boolean; // head of the rake is inside a tunnel
  doors: Doors; // door state while stopped at a platform; always closed while moving
  phase: Phase; // what the train is doing right now, for status text
  turnback: boolean; // pulling onto / rolling back from the tail track at a line end
  xover: { c: number; dA: 1 | -1 } | null; // set while crossing between tracks: station chainage, arrival direction
  next: string; // next station name (the current one while dwelling)
  etaSec: number; // seconds until arrival at `next` (0 while dwelling)
  coaches: number;
  lon: number;
  lat: number;
  bearing: number; // degrees, direction of travel
};

const rad = Math.PI / 180;
const hav = (a: number[], b: number[]) => {
  const h = Math.sin(((b[1] - a[1]) * rad) / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(((b[0] - a[0]) * rad) / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(h));
};

// ---- motion: trapezoidal speed profile over one inter-station segment ----
export function segmentTime(d: number, vmax: number, a = CONFIG.accel) {
  return d >= (vmax * vmax) / a ? d / vmax + vmax / a : 2 * Math.sqrt(d / a);
}
/** Distance covered and speed τ seconds into a segment of length d. */
export function segmentAt(d: number, vmax: number, tau: number, a = CONFIG.accel): [number, number] {
  const T = segmentTime(d, vmax, a);
  tau = Math.min(Math.max(tau, 0), T);
  const vp = d >= (vmax * vmax) / a ? vmax : Math.sqrt(a * d);
  const ta = vp / a;
  if (tau < ta) return [0.5 * a * tau * tau, a * tau];
  const cruiseT = T - 2 * ta;
  if (tau < ta + cruiseT) return [0.5 * a * ta * ta + vp * (tau - ta), vp];
  const r = T - tau; // time remaining; mirror image of the acceleration phase
  return [d - 0.5 * a * r * r, a * r];
}

/** Sideways offset (m, positive = left of the canonical path direction) of the rake at chainage s. Normal running keeps each
 * direction on its own track; a rake rolling back from the tail track bends through the crossover coach by coach. */
export function lateralAt(t: Pick<TrainState, 'dir' | 'xover'>, s: number) {
  const o = CONFIG.trackOffset;
  if (!t.xover) return t.dir * o;
  const { xoverStart: a, xoverEnd: b } = CONFIG.turnback;
  const r = t.xover.dA * (s - t.xover.c); // distance beyond the station towards the line end
  return t.dir * o * (1 - 2 * smooth((r - a) / (b - a))); // t.dir*o = reversing onto its own track; tail side = the arrival track
}

export const inTunnel = (l: Line, s: number) => l.tunnels.some(([a, b]) => s >= a && s <= b);

const dwellAt = (l: Line, idx: number) => {
  const s = l.stations[idx];
  if (s.code === 'KGWA') return CONFIG.dwellMajestic;
  return s.xfer.length ? CONFIG.dwellInterchange : CONFIG.dwell;
};

function buildLeg(l: Line, dir: 1 | -1, vmax: number): Leg {
  const n = l.stations.length;
  const seq = dir === 1 ? [...Array(n).keys()] : [...Array(n).keys()].reverse();
  const arr = [0], dep = [0], dist: number[] = [];
  for (let k = 1; k < n; k++) {
    const d = Math.abs(l.stations[seq[k]].stop - l.stations[seq[k - 1]].stop); // stop = where the rake stops, usually the station point
    dist.push(d);
    arr.push(dep[k - 1] + segmentTime(d, vmax));
    dep.push(arr[k] + dwellAt(l, seq[k]));
  }
  return { seq, arr, dep, dist, vmax };
}

function calibrate(l: Line): number {
  const target = (CONFIG.targetMinutes[l.id] ?? 0) * 60;
  if (!target) return 14;
  const run = (v: number) => buildLeg(l, 1, v).arr.at(-1)!;
  let lo = 6, hi = CONFIG.topSpeed;
  if (run(hi) >= target) return hi;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (run(mid) > target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

const hm = (s: string) => +s.slice(0, 2) * 3600 + +s.slice(3, 5) * 60;

export type Sim = ReturnType<typeof createSim>;

export function createSim(net: Network) {
  const lines = net.lines;
  const legs = lines.map((l) => {
    if (!l.open) return null;
    const v = calibrate(l);
    return { 1: buildLeg(l, 1, v), [-1]: buildLeg(l, -1, v) } as Record<1 | -1, Leg>;
  });
  const cum = lines.map((l) => l.cum ?? l.path.reduce<number[]>((c, p, i) => (c.push(i ? c[i - 1] + hav(l.path[i - 1], p) : 0), c), []));
  const trips: Record<string, Trip[]> = {};

  function tripsFor(day: DayKey): Trip[] {
    if (trips[day]) return trips[day];
    const out = new Map<string, Trip>();
    lines.forEach((l, li) => {
      const tt = (net.schedule[l.id] as Record<string, Timetable> | undefined)?.[day];
      if (!tt) return;
      const idx = (code: string) => {
        const i = l.stations.findIndex((s) => s.code === code);
        if (i < 0) throw new Error(`unknown station ${code} on ${l.id}`);
        return i;
      };
      const add = (from: string, to: string, t0: number) => {
        const i0 = idx(from), i1 = idx(to);
        const key = `${l.id}|${from}|${to}|${t0}`;
        out.set(key, { key, line: li, dir: i1 > i0 ? 1 : -1, i0, i1, t0, n: 0 });
      };
      for (const f of tt.frequency)
        for (const b of f.bands)
          for (let t = hm(b.start); t < hm(b.end); t += +b.headway * 60) add(f.from, f.toward, Math.round(t));
      for (const tr of tt.trips) for (const t of tr.times) add(tr.from, tr.to, hm(t));
    });
    const sorted = separate([...out.values()]).sort((a, b) => a.line - b.line || a.t0 - b.t0);
    linkTurnbacks(sorted);
    const seen: number[] = lines.map(() => 0);
    for (const tr of sorted) tr.n = tr.from ? tr.from.n : seen[tr.line]++; // stable per-day fleet number; a rake keeps its number through a turnback
    return (trips[day] = sorted);
  }

  // BMRCL publishes short-turn/through services and headway bands independently, so on paper trains can coincide on the same
  // track (e.g. one band ends the minute the next starts). Nudge each departure (within ±MAX_NUDGE) until it clears every through train by MIN_GAP.
  const MIN_GAP = 90, MAX_NUDGE = 300; // s; ponytail: greedy, not a real timetable optimiser
  let dropped = 0;
  function separate(all: Trip[]): Trip[] {
    const placed: Trip[] = [];
    const atStation = (tr: Trip, k: number) => {
      const leg = legs[tr.line]![tr.dir];
      return tr.t0 + leg.dep[k] - leg.dep[leg.seq.indexOf(tr.i0)];
    };
    const terminal = (tr: Trip) => tr.i0 === (tr.dir === 1 ? 0 : lines[tr.line].stations.length - 1);
    for (const tr of [...all.filter(terminal), ...all.filter((x) => !terminal(x))]) {
      {
        const leg = legs[tr.line]![tr.dir], k = leg.seq.indexOf(tr.i0);
        const k1 = leg.seq.indexOf(tr.i1);
        // Trains share every leg they are both on, so compare departure times at the later of the two origins.
        const pairs = placed.filter((o) => o.line === tr.line && o.dir === tr.dir).flatMap((o) => {
          const lo = legs[o.line]![o.dir], ko = lo.seq.indexOf(o.i0), ko1 = lo.seq.indexOf(o.i1);
          const m = Math.max(k, ko);
          return m <= Math.min(k1, ko1) ? [{ m, ot: atStation(o, m) }] : [];
        });
        const gap = (t: number) => Math.min(...pairs.map(({ m, ot }) => Math.abs(t + leg.dep[m] - leg.dep[k] - ot)), 1e9);
        let best = 0, bestGap = gap(tr.t0);
        for (let d = 10; d <= MAX_NUDGE && bestGap < MIN_GAP; d += 10)
          for (const c of [d, -d]) if (gap(tr.t0 + c) > bestGap) { best = c; bestGap = gap(tr.t0 + c); }
        if (bestGap < MIN_GAP) { dropped++; continue; } // no safe slot: a real operator would not run it
        tr.t0 += best;
      }
      placed.push(tr);
    }
    return placed;
  }

  // A train that ends at a line terminus turns back as the same rake: it pulls onto the tail track, waits, then rolls back
  // through the crossover for the next departure. Pair each terminal departure with the earliest arrival that can make it.
  function linkTurnbacks(all: Trip[]) {
    const TB = CONFIG.turnback, tbTime = segmentTime(TB_DIST, TB.speed);
    const last = (tr: Trip) => lines[tr.line].stations.length - 1;
    const ends: Trip[] = [], starts: Trip[] = [];
    const ready = new Map<Trip, number>();
    for (const tr of all) {
      const leg = legs[tr.line]![tr.dir], k0 = leg.seq.indexOf(tr.i0), k1 = leg.seq.indexOf(tr.i1);
      if (tr.i1 === (tr.dir === 1 ? last(tr) : 0)) {
        const arrEnd = tr.t0 + leg.arr[k1] - leg.dep[k0] + CONFIG.holdAtTerminus;
        tr.out = arrEnd + tbTime + TB.tailHold; // unpaired: parks on the tail track briefly, then is stabled
        ready.set(tr, arrEnd + tbTime + TB.minWait);
        ends.push(tr);
      }
      if (tr.i0 === (tr.dir === 1 ? 0 : last(tr))) { tr.ls = tr.t0 - CONFIG.holdAtOrigin - tbTime; starts.push(tr); }
    }
    const used = new Set<Trip>();
    for (const b of starts.sort((x, y) => x.ls! - y.ls!)) {
      const a = ends
        .filter((e) => !used.has(e) && e.line === b.line && e.i1 === b.i0 && ready.get(e)! <= b.ls! && b.ls! - ready.get(e)! <= TB.maxWait)
        .sort((x, y) => ready.get(x)! - ready.get(y)!)[0]; // earliest arrival first
      if (a) { used.add(a); a.out = b.ls; b.from = a; }
    }
  }

  /** Position/bearing of a point `s` metres along line `li`'s canonical path. */
  function posAt(li: number, s: number): [number, number, number] {
    const p = lines[li].path, c = cum[li];
    const total = c.at(-1)!, over = s < 0 ? s : s > total ? s - total : 0; // beyond the ends: straight on (tail track)
    s = Math.min(Math.max(s, 0), total);
    let lo = 0, hi = c.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= s) lo = m; else hi = m; }
    const t = (s - c[lo]) / (c[hi] - c[lo] || 1);
    const [x1, y1] = p[lo], [x2, y2] = p[hi];
    const bearing = (Math.atan2((x2 - x1) * Math.cos(y1 * rad), y2 - y1) / rad + 360) % 360;
    const lon = x1 + (x2 - x1) * t, lat = y1 + (y2 - y1) * t;
    if (!over) return [lon, lat, bearing];
    return [lon + (over * Math.sin(bearing * rad)) / (6371008.8 * Math.cos(lat * rad) * rad), lat + (over * Math.cos(bearing * rad)) / (6371008.8 * rad), bearing];
  }

  function stateOf(tr: Trip, t: number): TrainState | null {
    const l = lines[tr.line], leg = legs[tr.line]![tr.dir];
    const k0 = leg.seq.indexOf(tr.i0), k1 = leg.seq.indexOf(tr.i1);
    const TB = CONFIG.turnback, tbTime = segmentTime(TB_DIST, TB.speed);
    const stopAt = (i: number) => l.stations[i].stop + tr.dir * STOP; // rake centred on the platform
    const rel = t - tr.t0; // seconds since scheduled departure from origin
    const span = leg.arr[k1] - leg.dep[k0];
    const h = 100 + ((tr.n * 389) % 900); // 389 is coprime with 900, so unique per line per day
    const mk = (s: number, v: number, moving: boolean, nextStation: number, eta: number, extra: Partial<TrainState> = {}): TrainState => {
      const [lon, lat, b] = posAt(tr.line, s);
      return {
        tripKey: tr.key,
        id: `KA-0${tr.line + 1}-${l.id[0].toUpperCase()}-${h}`,
        line: l.id, color: l.color, dir: tr.dir,
        headingTo: l.stations[tr.i1].name,
        chainage: s, speed: v, underground: inTunnel(l, s), state: moving ? 'running' : 'dwelling',
        doors: 'closed', phase: moving ? 'cruising' : 'dwell', turnback: false, xover: null,
        next: l.stations[nextStation].name, etaSec: eta,
        coaches: CONFIG.coaches, lon, lat, bearing: tr.dir === 1 ? b : (b + 180) % 360,
        ...extra,
      };
    };
    // Rolling back from the tail track onto this train's own platform, bending through the crossover.
    if (tr.ls !== undefined && t >= tr.ls && t < tr.t0 - CONFIG.holdAtOrigin) {
      const tau = t - tr.ls, [ds, v] = segmentAt(TB_DIST, TB.speed, tau);
      const dA = (-tr.dir) as 1 | -1, c = l.stations[tr.i0].stop;
      return mk(c + dA * (TB.tailHead - RAKE_LEN - ds), v, tau < tbTime, tr.i0, Math.max(0, tbTime - tau), { turnback: true, xover: { c, dA }, phase: 'from-tail' });
    }
    if (rel < -CONFIG.holdAtOrigin) return null;
    if (rel > span + CONFIG.holdAtTerminus) {
      // After the platform stop at a line end: pull ahead onto the tail track and wait there.
      if (tr.out === undefined || t > tr.out) return null;
      const tau = rel - span - CONFIG.holdAtTerminus, [ds, v] = segmentAt(TB_DIST, TB.speed, tau);
      return mk(stopAt(tr.i1) + tr.dir * ds, v, tau < tbTime, tr.i1, 0, { turnback: true, phase: tau < tbTime ? 'to-tail' : 'parked' });
    }
    const e = rel + leg.dep[k0]; // elapsed on the full-line timeline
    let k = k0, s: number, v = 0, moving = false, next: number, eta = 0;
    let dwell: [number, number] | null = null; // [seconds since the doors' cycle began, cycle length] while stopped at a platform
    if (e <= leg.dep[k0]) {
      s = stopAt(leg.seq[k0]); next = k0;
      dwell = [rel + CONFIG.holdAtOrigin, CONFIG.holdAtOrigin]; // boarding before departure
    } else {
      // find segment: arr[k+1] > e
      k = k0;
      while (k < k1 && e >= leg.dep[k + 1]) k++;
      if (k < k1 && e >= leg.dep[k]) {
        const d = leg.dist[k];
        const [ds, vv] = segmentAt(d, leg.vmax, e - leg.dep[k]);
        const from = stopAt(leg.seq[k]);
        s = from + tr.dir * ds; v = vv; moving = e < leg.arr[k + 1]; next = k + 1; eta = Math.max(0, leg.arr[k + 1] - e);
        if (!moving) {
          s = stopAt(leg.seq[k + 1]); v = 0; eta = 0;
          dwell = [e - leg.arr[k + 1], k + 1 === k1 ? CONFIG.holdAtTerminus : leg.dep[k + 1] - leg.arr[k + 1]];
        }
      } else {
        s = stopAt(leg.seq[k]); next = k;
        dwell = [e - leg.arr[k], CONFIG.holdAtTerminus]; // at the last station
      }
    }
    if (dwell) return mk(s, v, moving, leg.seq[next], eta, { doors: doorsAt(dwell[0], dwell[1]), phase: 'dwell' });
    const phase: Phase = eta < 15 ? 'arriving' : e - leg.dep[k] < 8 ? 'departing' : 'cruising';
    return mk(s, v, moving, leg.seq[next], eta, { phase });
  }

  /** All active trains at epoch ms `now`. Timetables are IST; the viewer's timezone is irrelevant. */
  function getTrains(now: number): TrainState[] {
    const ist = new Date(now + CONFIG.timeOffset * 1000 + 5.5 * 3600e3);
    const sec = ist.getUTCHours() * 3600 + ist.getUTCMinutes() * 60 + ist.getUTCSeconds() + ist.getUTCMilliseconds() / 1000;
    const out: TrainState[] = [];
    // Service day of today, and of yesterday (trips that began before midnight and are still running).
    for (const back of [0, 1]) {
      const d = new Date(ist.getTime() - back * 86400e3);
      const dow = d.getUTCDay(); // 0 Sun
      const day: DayKey = dow === 0 ? 'sunday' : dow === 6 ? 'saturday' : dow === 1 ? 'monday' : 'weekday';
      const t = sec + back * 86400;
      for (const tr of tripsFor(day)) {
        if (!legs[tr.line]) continue;
        const s = stateOf(tr, t);
        if (s) out.push(s);
      }
    }
    return out;
  }

  return { getTrains, posAt, legs, cum, lines, tripsFor, dropped: () => dropped };
}

