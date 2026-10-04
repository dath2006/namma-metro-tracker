import Link from 'next/link';
import { Shell } from '@/components/SeoShell';

export default function NotFound() {
  return (
    <Shell>
      <h1 className="text-3xl font-bold">Page not found</h1>
      <p className="mt-4 text-white/70">That page does not exist. Try the live map, or browse the lines and stations.</p>
      <div className="mt-6 flex gap-3 text-sm">
        <Link href="/" className="rounded-lg bg-purple-600 px-4 py-2 font-semibold hover:bg-purple-500">Live map</Link>
        <Link href="/lines" className="rounded-lg bg-white/10 px-4 py-2 hover:bg-white/15">Lines</Link>
        <Link href="/stations" className="rounded-lg bg-white/10 px-4 py-2 hover:bg-white/15">Stations</Link>
      </div>
    </Shell>
  );
}
