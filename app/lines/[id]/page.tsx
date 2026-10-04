import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Crumbs, JsonLd, LineChip, Shell, breadcrumbLd } from '@/components/SeoShell';
import { lineById, lineKm, lineTitle, net, shortName, stationByCode, timings } from '@/lib/content';
import { SITE, abs } from '@/lib/site';

export const dynamicParams = false;
export const generateStaticParams = () => net().lines.map((l) => ({ id: l.id }));

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const l = lineById((await params).id);
  if (!l) return {};
  const title = `${l.name}: Stations, Timings & Live Map`;
  const description = l.open
    ? `Namma Metro ${l.name}: all ${l.stations.length} stations from ${shortName(l.stations[0].name)} to ${shortName(l.stations.at(-1)!.name)}, ${lineKm(l)} km, first and last train, train frequency and a live 3D map.`
    : `Namma Metro ${l.name} (under construction): planned stations from ${shortName(l.stations[0].name)} to ${shortName(l.stations.at(-1)!.name)}, ${lineKm(l)} km.`;
  const url = `/lines/${l.id}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { type: 'website', url: abs(url), title, description, siteName: SITE.name, locale: SITE.locale },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function Page({ params }: Props) {
  const l = lineById((await params).id);
  if (!l) notFound();
  const path = `/lines/${l.id}`;
  const first = l.stations[0], last = l.stations.at(-1)!;
  const times = l.open ? [...timings(first.code), ...timings(last.code)].filter((t) => t.line.id === l.id) : [];
  const ug = l.tunnels.length;

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `${l.name} stations`,
    itemListElement: l.stations.map((s, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: s.name,
      ...(l.open ? { url: abs(`/stations/${stationByCode(s.code)?.slug ?? ''}`) } : {}),
    })),
  };

  return (
    <Shell>
      <JsonLd data={ld} />
      <JsonLd data={breadcrumbLd([{ name: 'Home', path: '/' }, { name: 'Lines', path: '/lines' }, { name: l.name, path }])} />
      <Crumbs items={[{ name: 'Home', path: '/' }, { name: 'Lines', path: '/lines' }, { name: l.name, path }]} />

      <h1 className="text-3xl font-bold tracking-tight">{lineTitle(l)}</h1>
      <div className="mt-3 flex items-center gap-2">
        <LineChip name={l.name} color={l.color} />
        <span className="text-sm text-white/60">{l.open ? 'In service' : 'Under construction, not yet open'}</span>
      </div>

      <p className="mt-6 leading-relaxed text-white/80">
        The {l.name} of Namma Metro runs {lineKm(l)} km between {first.name} and {last.name}, with {l.stations.length} stations
        {ug ? ', including an underground section' : ', all on an elevated viaduct'}.
        {l.open
          ? ' Trains are six coaches long and run about every 3 to 15 minutes depending on the time of day.'
          : ' It is not carrying passengers yet, so there are no trains to track.'}
      </p>

      {l.open && (
        <Link href={`/?line=${l.id}`} className="mt-6 inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-semibold hover:bg-purple-500">
          See {l.name} trains on the live map →
        </Link>
      )}

      {times.length > 0 && (
        <>
          <h2 className="mt-10 text-xl font-semibold">First and last trains</h2>
          <p className="mt-1 text-sm text-white/60">Approximate weekday departures from each end of the line, from the timetable simulation.</p>
          <ul className="mt-3 space-y-2 text-sm">
            {times.map((t) => (
              <li key={t.toward} className="rounded-xl border border-white/10 p-3">
                Towards <b>{shortName(t.toward)}</b>: first train <b className="tabular-nums">{t.first}</b>, last train <b className="tabular-nums">{t.last}</b>
                {t.peak && <>, every <b>{t.peak} min</b> at 9 am</>}
                {t.offPeak && <>, every <b>{t.offPeak} min</b> at midday</>}.
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 className="mt-10 text-xl font-semibold">All {l.name} stations</h2>
      <ol className="mt-3 divide-y divide-white/10 text-sm">
        {l.stations.map((s, i) => {
          const sp = stationByCode(s.code);
          return (
            <li key={s.code} className="flex items-center gap-3 py-2.5">
              <span className="w-6 text-right text-xs tabular-nums text-white/40">{i + 1}</span>
              <i className="h-2.5 w-2.5 rounded-full" style={{ background: l.color }} />
              {l.open && sp ? <Link href={`/stations/${sp.slug}`} className="hover:underline">{s.name}</Link> : <span>{s.name}</span>}
              {s.kn && <span lang="kn" className="ml-auto hidden text-xs text-white/40 sm:inline">{s.kn}</span>}
            </li>
          );
        })}
      </ol>
    </Shell>
  );
}
