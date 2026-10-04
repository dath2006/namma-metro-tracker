import type { Metadata, Viewport } from 'next';
import { preconnect, preload } from 'react-dom';
import './globals.css';
import { SITE } from '@/lib/site';

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  applicationName: SITE.name,
  title: { default: SITE.title, template: '%s | Namma Metro Tracker' },
  description: SITE.description,
  keywords: SITE.keywords,
  authors: [{ name: SITE.name }],
  creator: SITE.name,
  category: 'transportation',
  formatDetection: { telephone: false, email: false, address: false },
  openGraph: { type: 'website', siteName: SITE.name, locale: SITE.locale, title: SITE.title, description: SITE.description, url: '/' },
  twitter: { card: 'summary_large_image', title: SITE.title, description: SITE.description },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 } },
  // each page sets its own canonical; a site-wide one here would point every page at the home page
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0b0d14',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Start the satellite-tile connection and the route data fetch before the map code has even loaded.
  preconnect('https://server.arcgisonline.com');
  preconnect('https://demotiles.maplibre.org');
  preload('/data/network.json', { as: 'fetch', crossOrigin: 'anonymous' });
  return (
    <html lang="en-IN">
      <body>{children}</body>
    </html>
  );
}
