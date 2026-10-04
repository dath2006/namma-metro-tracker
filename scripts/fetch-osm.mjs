// Fetch under-construction Pink (6119472) and Blue (21256532) routes, then names of their stop nodes, from OSM.
import { writeFileSync } from 'node:fs';

const post = async (q) => {
  for (let i = 0; i < 8; i++) {
    const r = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'User-Agent': 'namma-metro-tracker/0.1', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(q),
    });
    const t = await r.text();
    if (t.startsWith('{')) return JSON.parse(t);
    await new Promise((ok) => setTimeout(ok, 15000)); // server busy: retry
  }
  throw new Error('overpass busy');
};

const rels = await post('[out:json][timeout:120];rel(id:6119472,21256532);out geom;');
writeFileSync('data/raw/pinkblue.json', JSON.stringify(rels));
const ids = rels.elements.flatMap((e) => e.members.filter((m) => m.type === 'node').map((m) => m.ref));
writeFileSync('data/raw/pinkblue-nodes.json', JSON.stringify(await post(`[out:json][timeout:120];node(id:${ids.join(',')});out;`)));
