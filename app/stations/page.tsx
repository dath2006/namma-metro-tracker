import type { Metadata } from 'next';
import Link from 'next/link';
import { Crumbs, JsonLd, LineChip, Shell, breadcrumbLd } from '@/components/SeoShell';
import { allStations, net, stationByCode } from '@/lib/content';
import { SITE, abs } from '@/lib/site';

const title = 'Namma Metro Stations: Full List with Timings';
const description = 'Every Namma Metro station in Bengaluru on the Purple, Green and Yellow lines, with first and last train times, interchanges and a live map of arriving trains.';
export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/stations' },
  openGraph: { type: 'website', url: abs('/stations'), title, description, siteName: SITE.name, locale: SITE.locale },
  twitter: { card: 'summary_large_image', title, description },
};

export default function Page() {
  const open = net().lines.filter((l) => l.open);
  return (
    <Shell>
      <JsonLd data={breadcrumbLd([{ name: 'Home', path: '/' }, { name: 'Stations', path: '/stations' }])} />
      <Crumbs items={[{ name: 'Home', path: '/' }, { name: 'Stations', path: '/stations' }]} />
      <h1 className="text-3xl font-bold tracking-tight">Namma Metro stations</h1>
      <p className="mt-4 leading-relaxed text-white/80">
        {allStations().length} stations across the Purple, Green and Yellow lines. Choose a station for its train timings, neighbouring stations and a live map.
      </p>
      {open.map((l) => (
        <section key={l.id} className="mt-10">
          <h2 className="flex items-center gap-3 text-xl font-semibold">
            <LineChip name={l.name} color={l.color} />
            <Link href={`/lines/${l.id}`} className="hover:underline">{l.stations.length} stations</Link>
          </h2>
          <ul className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {l.stations.map((s) => {
              const sp = stationByCode(s.code)!;
              return (
                <li key={s.code}>
                  <Link href={`/stations/${sp.slug}`} className="block py-1.5 text-white/80 hover:text-white hover:underline">{sp.short}</Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </Shell>
  );
}
