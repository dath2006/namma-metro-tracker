import type { Metadata } from 'next';
import Link from 'next/link';
import MetroMap from '@/components/MetroMap';
import { JsonLd } from '@/components/SeoShell';
import { lineKm, lineTitle, net, stationByCode } from '@/lib/content';
import { SITE, abs } from '@/lib/site';

export const metadata: Metadata = {
  title: { absolute: SITE.title },
  alternates: { canonical: '/' },
};

// Interchanges and landmarks people actually search for.
const POPULAR = ['KGWA', 'MAGR', 'WHTM', 'CLGA', 'SBJT', 'IDN', 'KRAM', 'BYPH', 'RVR', 'JDHP', 'BMSD', 'NGSA'];

export default function Page() {
  const lines = net().lines;
  const popular = POPULAR.map((c) => stationByCode(c)).filter((s) => !!s);

  const ld = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: SITE.name,
      alternateName: SITE.kn,
      url: abs('/'),
      description: SITE.description,
      applicationCategory: 'TravelApplication',
      operatingSystem: 'Any (web browser)',
      browserRequirements: 'Requires JavaScript and WebGL',
      inLanguage: 'en-IN',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'INR' },
      about: { '@type': 'Thing', name: 'Namma Metro, Bengaluru' },
    },
    { '@context': 'https://schema.org', '@type': 'WebSite', name: SITE.name, url: abs('/'), inLanguage: 'en-IN' },
  ];

  return (
    <>
      <MetroMap />
      <JsonLd data={ld} />
      {/* Crawlable, screen-reader-friendly description of what the map shows; the map itself is canvas-only. */}
      <article className="sr-only">
        <h1>Namma Metro Live Tracker: Bengaluru Metro on a live 3D map</h1>
        <p>
          Watch Bengaluru&rsquo;s Namma Metro ({SITE.kn}) trains move along the Purple, Green and Yellow lines on a realistic 3D satellite map. Click any train to follow it
          and see its speed, next stop and whether its doors are opening, open or closing. Trains stop at the platforms, and at the end of the line they change tracks to
          start the return trip.
        </p>
        <h2>How it works</h2>
        <p>
          BMRCL does not publish real-time train positions, so this tracker is a simulation. It runs every train from the published timetable patterns, with realistic
          acceleration, braking, station stops and a top speed of 80 km/h, so what you see matches what the timetable says should be happening right now.
        </p>
        <h2>Namma Metro lines</h2>
        <ul>
          {lines.map((l) => (
            <li key={l.id}>
              <Link href={`/lines/${l.id}`}>{lineTitle(l)}</Link>: {l.stations.length} stations, {lineKm(l)} km, {l.open ? 'in service' : 'under construction'}
            </li>
          ))}
        </ul>
        <h2>Popular metro stations</h2>
        <ul>
          {popular.map((s) => (
            <li key={s!.code}>
              <Link href={`/stations/${s!.slug}`}>{s!.short} metro station</Link>
            </li>
          ))}
        </ul>
        <p>
          <Link href="/stations">All Namma Metro stations</Link> · <Link href="/lines">All metro lines</Link>
        </p>
      </article>
    </>
  );
}
