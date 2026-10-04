import type { Metadata } from 'next';
import Link from 'next/link';
import { Crumbs, JsonLd, LineChip, Shell, breadcrumbLd } from '@/components/SeoShell';
import { lineKm, lineTitle, net } from '@/lib/content';
import { SITE, abs } from '@/lib/site';

const title = 'Namma Metro Lines: Purple, Green, Yellow, Pink & Blue';
const description = 'All Bengaluru Namma Metro lines: Purple, Green and Yellow in service, Pink and Blue under construction. Stations, length and timings for each line.';
export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/lines' },
  openGraph: { type: 'website', url: abs('/lines'), title, description, siteName: SITE.name, locale: SITE.locale },
  twitter: { card: 'summary_large_image', title, description },
};

export default function Page() {
  const lines = net().lines;
  return (
    <Shell>
      <JsonLd data={breadcrumbLd([{ name: 'Home', path: '/' }, { name: 'Lines', path: '/lines' }])} />
      <Crumbs items={[{ name: 'Home', path: '/' }, { name: 'Lines', path: '/lines' }]} />
      <h1 className="text-3xl font-bold tracking-tight">Namma Metro lines</h1>
      <p className="mt-4 leading-relaxed text-white/80">
        Bengaluru&rsquo;s metro has three lines in service today and two under construction. Pick a line for its station list, timings and a live map of its trains.
      </p>
      <ul className="mt-8 space-y-3">
        {lines.map((l) => (
          <li key={l.id}>
            <Link href={`/lines/${l.id}`} className="block rounded-xl border border-white/10 p-4 hover:bg-white/5">
              <LineChip name={l.name} color={l.color} />
              <div className="mt-2 font-semibold">{lineTitle(l)}</div>
              <div className="mt-1 text-sm text-white/60">{l.stations.length} stations · {lineKm(l)} km · {l.open ? 'in service' : 'under construction'}</div>
            </Link>
          </li>
        ))}
      </ul>
    </Shell>
  );
}
