// Smallest check that fails if the simulation breaks. Run: node scripts/check-engine.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSim, CONFIG, RAKE_LEN, lateralAt, segmentAt, segmentTime } from '../lib/engine.ts';

const net = JSON.parse(readFileSync('public/data/network.json', 'utf8'));
const sim = createSim(net); // throws if any timetable station code is unknown
const ist = (y, mo, d, h, mi = 0, s = 0) => Date.UTC(y, mo - 1, d, h, mi, s) - 5.5 * 3600e3;

// motion profile: ends exactly at d, never exceeds vmax, speed 0 at both ends
for (const d of [400, 1100, 3000]) {
  const T = segmentTime(d, 15);
  assert.ok(Math.abs(segmentAt(d, 15, T)[0] - d) < 1e-6 && segmentAt(d, 15, T)[1] < 1e-6 && segmentAt(d, 15, 0)[1] === 0);
  for (let t = 0; t <= T; t += 0.5) assert.ok(segmentAt(d, 15, t)[1] <= 15 + 1e-9);
}

// calibrated end-to-end time hits the targets
for (const [i, l] of sim.lines.entries()) {
  if (!l.open) continue;
  const leg = sim.legs[i][1];
  assert.ok(Math.abs(leg.arr.at(-1) / 60 - CONFIG.targetMinutes[l.id]) < 0.5, `${l.id} e2e`);
  console.log(l.id, 'cruise', (leg.vmax * 3.6).toFixed(0), 'km/h, end-to-end', (leg.arr.at(-1) / 60).toFixed(1), 'min');
}

const xo = { dir: -1, xover: { c: 1000, dA: 1 } };
assert.equal(lateralAt(xo, 1000), -CONFIG.trackOffset); // platform side: own track
assert.equal(lateralAt(xo, 1000 + CONFIG.turnback.xoverEnd + 5), CONFIG.trackOffset); // tail side: arrival track
const count = (ts, id) => ts.filter((t) => t.line === id).length;
const tue = (h, m = 0) => sim.getTrains(ist(2026, 10, 6, h, m)); // Tue 6 Oct 2026
assert.equal(tue(2).length, 0, 'no trains at 02:00');
for (const [h, m] of [[9, 0], [13, 0], [18, 0], [21, 30]]) {
  const ts = tue(h, m);
  console.log(`Tue ${h}:${String(m).padStart(2, '0')}`, ['purple', 'green', 'yellow'].map((id) => `${id}=${count(ts, id)}`).join(' '));
  assert.ok(count(ts, 'pink') + count(ts, 'blue') === 0, 'upcoming lines have no trains');
  assert.ok(ts.length > 15);
}
assert.ok(tue(9).length > tue(13).length * 0.9, 'peak is not quieter than midday');

// physical sanity over a full day: speed cap, continuity (<= vmax*dt), spacing between same-direction trains
let prev = new Map(), turnbacks = 0, crossings = 0;
const dirs = {}, doorSeen = new Set(), phaseSeen = new Set();
for (let t = ist(2026, 10, 6, 5); t < ist(2026, 10, 7, 0, 30); t += 5000) {
  const ts = sim.getTrains(t);
  const cur = new Map(ts.map((x) => [x.id, x]));
  for (const x of ts) {
    assert.ok(x.speed <= CONFIG.topSpeed + 1e-6, 'speed cap');
    if (x.speed > 0) assert.equal(x.doors, 'closed', 'doors must be shut while moving');
    doorSeen.add(x.doors); phaseSeen.add(x.phase);
    const p = prev.get(x.id);
    if (p && p.dir === x.dir && !p.turnback && !x.turnback) assert.ok(Math.abs(x.chainage - p.chainage) <= CONFIG.topSpeed * 5 + 1, `jump ${x.id}`);
  }
  const byGroup = {};
  for (const x of ts) if (x.state === 'running' && !x.turnback) (byGroup[x.line + x.dir] ??= []).push(x.chainage); // dwelling rakes at a terminus legitimately overlap the next departure
  for (const [g, a] of Object.entries(byGroup)) {
    a.sort((p, q) => p - q);
    for (let i = 1; i < a.length; i++) assert.ok(a[i] - a[i - 1] > 150, `trains bunched on ${g}: ${a[i] - a[i - 1]}m`);
  }
  // platform stops are centred: a dwelling rake's head sits half a rake past the station point
  for (const x of ts) {
    if (x.state !== 'dwelling' || x.turnback) continue;
    const l = sim.lines.find((q) => q.id === x.line), st = l.stations.find((q) => q.name === x.next);
    assert.ok(Math.abs(x.chainage - (st.stop + x.dir * RAKE_LEN / 2)) < 0.5, `${x.id} not centred at ${x.next}`);
  }
  for (const x of ts) if (x.turnback) { turnbacks++; dirs[x.id] = new Set([...(dirs[x.id] ?? []), x.dir]); if (x.xover) crossings++; }
  prev = cur;
}
// midnight rollover: a train that left before midnight is still tracked after it
console.log('Tue 23:50 trains', tue(23, 50).length, '| Wed 00:10 trains', sim.getTrains(ist(2026, 10, 7, 0, 10)).length);
console.log('short-turn trips dropped for lack of a safe slot (all day types so far):', sim.dropped());
assert.ok(turnbacks > 0 && crossings > 0, 'turnback animation never ran');
console.log('turnback samples', turnbacks, '| crossover samples', crossings);
for (const d of ['closed', 'opening', 'open', 'closing']) assert.ok(doorSeen.has(d), 'door state never seen: ' + d);
console.log('door states', [...doorSeen].join(','), '| phases', [...phaseSeen].join(','));
console.log('OK');
