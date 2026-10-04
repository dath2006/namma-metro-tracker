import type { MetadataRoute } from 'next';
import { allStations, net } from '@/lib/content';
import { abs } from '@/lib/site';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: abs('/'), lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: abs('/lines'), lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: abs('/stations'), lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    ...net().lines.map((l) => ({ url: abs(`/lines/${l.id}`), lastModified: now, changeFrequency: 'monthly' as const, priority: 0.8 })),
    ...allStations().map((s) => ({ url: abs(`/stations/${s.slug}`), lastModified: now, changeFrequency: 'monthly' as const, priority: 0.6 })),
  ];
}
