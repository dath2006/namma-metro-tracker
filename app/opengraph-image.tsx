import { ImageResponse } from 'next/og';

export const alt = 'Namma Metro Live Tracker: Bengaluru Metro trains on a live 3D map';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const LINES = ['#a23bec', '#1faa59', '#f5c518'];

export default function OgImage() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 72, background: 'linear-gradient(135deg, #0b0d14 0%, #1b1030 100%)', color: 'white' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ display: 'flex', width: 72, height: 72, borderRadius: 18, background: '#7c3aed', alignItems: 'center', justifyContent: 'center', fontSize: 44, fontWeight: 800 }}>M</div>
          <div style={{ display: 'flex', fontSize: 34, color: '#c9cbe0' }}>Namma Metro · Bengaluru</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', fontSize: 84, fontWeight: 800, lineHeight: 1.05 }}>Live Tracker</div>
          <div style={{ display: 'flex', fontSize: 38, color: '#c9cbe0' }}>Watch trains run on a 3D satellite map: speed, next stop and door status</div>
        </div>
        <div style={{ display: 'flex', gap: 14 }}>
          {LINES.map((c) => <div key={c} style={{ display: 'flex', height: 14, width: 180, borderRadius: 7, background: c }} />)}
        </div>
      </div>
    ),
    size,
  );
}
