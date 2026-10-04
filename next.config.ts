import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  turbopack: { root: __dirname },
  distDir: process.env.NEXT_DIST_DIR ?? '.next', // lets a production build run beside a running dev server
  poweredByHeader: false,
  async headers() {
    return [
      // route data and the map worker rarely change: let browsers and CDNs reuse them
      { source: '/data/:path*', headers: [{ key: 'Cache-Control', value: 'public, max-age=3600, stale-while-revalidate=86400' }] },
      { source: '/maplibre/:path*', headers: [{ key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' }] },
      { source: '/admin', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] },
    ];
  },
};

export default nextConfig;
