import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Crumbs, JsonLd, LineChip, Shell, breadcrumbLd } from '@/components/SeoShell';
import { allStations, lineById, neighbours, stationBySlug, timings } from '@/lib/content';
import { SITE, abs } from '@/lib/site';

export const dynamicParams = false; // only the stations that exist
export const generateStaticParams = () => allStations().map((s) => ({ slug: s.slug }));

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const s = stationBySlug((await params).slug);
  if (!s) return {};
  const lines = s.lineIds.map((id) => lineById(id)!.name).join(' & ');
  const title = `${s.short} Metro Station: Timings & Live Trains`; // kept short: the layout appends the site name
  const description = `${s.short} metro station (${s.name}) on Bengaluru's ${lines}: first and last train, how often trains run, neighbouring stations and a live 3D map of trains arriving.`;
  const url = `/stations/${s.slug}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { type: 'website', url: abs(url), title, description, siteName: SITE.name, locale: SITE.locale },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function Page({ params }: Props) {
  const s = stationBySlug((await params).slug);
  if (!s) notFound();
  const lines = s.lineIds.map((id) => lineById(id)!);
  const times = timings(s.code);
  const near = neighbours(s.code);
  const path = `/stations/${s.slug}`;

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'TrainStation',
    name: s.name,
    ...(s.kn ? { alternateName: s.kn } : {}),
    url: abs(path),
    geo: { '@type': 'GeoCoordinates', latitude: s.lat, longitude: s.lon },
    address: { '@type': 'PostalAddress', addressLocality: 'Bengaluru', addressRegion: 'Karnataka', addressCountry: 'IN' },
    description: `${s.short} station on the ${lines.map((l) => l.name).join(' and ')} of Namma Metro, Bengaluru.`,
  };

  return (
    <Shell>
      <JsonLd data={ld} />
      <JsonLd data={breadcrumbLd([{ name: 'Home', path: '/' }, { name: 'Stations', path: '/stations' }, { name: s.short, path }])} />
      <Crumbs items={[{ name: 'Home', path: '/' }, { name: 'Stations', path: '/stations' }, { name: s.short, path }]} />

      <h1 className="text-3xl font-bold tracking-tight">{s.short} Metro Station</h1>
      {s.kn && <p lang="kn" className="mt-1 text-white/60">{s.kn}</p>}
      <div className="mt-3 flex flex-wrap gap-2">{lines.map((l) => <LineChip key={l.id} name={l.name} color={l.color} />)}</div>

      <p className="mt-6 leading-relaxed text-white/80">
        {s.name} is a station on Bengaluru&rsquo;s Namma Metro {lines.map((l) => l.name).join(' and ')}.
        {near.some((n) => n.underground) ? ' The station is underground.' : ' The station is elevated.'}
        {lines.length > 1 && ` It is an interchange: passengers can change between the ${lines.map((l) => l.name).join(' and ')} here.`}
      </p>

      <Link href={`/?station=${s.code}`} className="mt-6 inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-semibold hover:bg-purple-500">
        Watch trains at {s.short} on the live map →
      </Link>

      <h2 className="mt-10 text-xl font-semibold">Train timings at {s.short}</h2>
      <p className="mt-1 text-sm text-white/60">Approximate weekday (Tuesday to Friday) pattern, from the timetable simulation. Weekends differ.</p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[32rem] text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-white/50">
            <tr><th className="py-2 pr-4">Line</th><th className="py-2 pr-4">Towards</th><th className="py-2 pr-4">First train</th><th className="py-2 pr-4">Last train</th><th className="py-2 pr-4">Peak (9 am)</th><th className="py-2">Midday</th></tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {times.map((t) => (
              <tr key={t.line.id + t.toward}>
                <td className="py-2.5 pr-4"><LineChip name={t.line.name.replace(' Line', '')} color={t.line.color} /></td>
                <td className="py-2.5 pr-4">{t.toward.replace(/\s*\(.*\)/, '')}</td>
                <td className="py-2.5 pr-4 tabular-nums">{t.first}</td>
                <td className="py-2.5 pr-4 tabular-nums">{t.last}</td>
                <td className="py-2.5 pr-4 tabular-nums">{t.peak ? `every ${t.peak} min` : '–'}</td>
                <td className="py-2.5 tabular-nums">{t.offPeak ? `every ${t.offPeak} min` : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-10 text-xl font-semibold">Neighbouring stations</h2>
      <ul className="mt-3 space-y-3 text-sm">
        {near.map((n) => (
          <li key={n.line.id} className="rounded-xl border border-white/10 p-4">
            <LineChip name={n.line.name} color={n.line.color} />
            <div className="mt-2 grid gap-1 sm:grid-cols-2">
              <div><span className="text-white/50">Towards {n.towardPrev}: </span>{n.prev ? <Link className="underline decoration-white/30 hover:decoration-white" href={`/stations/${n.prev.slug}`}>{n.prev.short}</Link> : 'end of the line'}</div>
              <div><span className="text-white/50">Towards {n.towardNext}: </span>{n.next ? <Link className="underline decoration-white/30 hover:decoration-white" href={`/stations/${n.next.slug}`}>{n.next.short}</Link> : 'end of the line'}</div>
            </div>
            <Link href={`/lines/${n.line.id}`} className="mt-2 inline-block text-xs text-white/60 hover:text-white">All {n.line.name} stations →</Link>
          </li>
        ))}
      </ul>
    </Shell>
  );
}
