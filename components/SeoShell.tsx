import Link from 'next/link';
import { SITE, abs } from '@/lib/site';

/** Renders schema.org JSON-LD. `<` is escaped so content can never close the script tag. */
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }} />;
}

export const breadcrumbLd = (items: { name: string; path: string }[]) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: abs(it.path) })),
});

export function Crumbs({ items }: { items: { name: string; path: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-6 text-xs text-white/50">
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((it, i) => (
          <li key={it.path} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden>/</span>}
            {i === items.length - 1 ? <span aria-current="page" className="text-white/80">{it.name}</span> : <Link href={it.path} className="hover:text-white">{it.name}</Link>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Shared chrome for the readable (non-map) pages. */
export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0b0d14] text-[#e8e9f0]">
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-4 text-sm">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-purple-600">Ⓜ</span>
            {SITE.short} Tracker
          </Link>
          <nav aria-label="Main" className="flex gap-4 text-white/70">
            <Link href="/lines" className="hover:text-white">Lines</Link>
            <Link href="/stations" className="hover:text-white">Stations</Link>
          </nav>
          <Link href="/" className="ml-auto rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold hover:bg-purple-500">Open live map</Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10">{children}</main>
      <footer className="border-t border-white/10">
        <div className="mx-auto max-w-3xl space-y-2 px-4 py-8 text-xs leading-relaxed text-white/50">
          <p>
            Train positions on this site are a simulation built from the timetable patterns BMRCL publishes. BMRCL does not release real-time GPS, so exact arrival
            times can differ by several minutes. Check the official BMRCL channels for travel decisions. This is an independent project, not affiliated with BMRCL.
          </p>
          <p>Route and station data © OpenStreetMap contributors (ODbL), via the unofficial bmrcl-gtfs dataset. Satellite imagery © Esri, Maxar, Earthstar Geographics.</p>
        </div>
      </footer>
    </div>
  );
}

export function LineChip({ name, color }: { name: string; color: string }) {
  return <span className="rounded-md px-2 py-0.5 text-xs font-semibold text-black" style={{ background: color }}>{name}</span>;
}
