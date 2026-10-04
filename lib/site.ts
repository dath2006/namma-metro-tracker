// Set NEXT_PUBLIC_SITE_URL in .env.local (or your host's env) to the real public origin before launch:
// canonical URLs, the sitemap, robots.txt and social previews are all built from it.
export const SITE = {
  name: 'Namma Metro Live Tracker',
  short: 'Namma Metro',
  kn: 'ನಮ್ಮ ಮೆಟ್ರೋ',
  url: (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3001').replace(/\/$/, ''),
  locale: 'en_IN',
  title: 'Namma Metro Live Tracker | Bengaluru Metro Live 3D Map',
  description:
    'Watch Namma Metro trains run on a 3D satellite map of Bengaluru: Purple, Green & Yellow lines, speed, next stop and door status. Timetable-based simulation.',
  keywords: [
    'Namma Metro', 'Bengaluru metro', 'Bangalore metro live tracker', 'Namma Metro live train tracking', 'BMRCL', 'metro timings',
    'Purple Line', 'Green Line', 'Yellow Line', 'Pink Line', 'Majestic metro station', 'Whitefield metro', 'Challaghatta metro', 'ನಮ್ಮ ಮೆಟ್ರೋ',
  ],
};

export const abs = (path: string) => `${SITE.url}${path}`;
