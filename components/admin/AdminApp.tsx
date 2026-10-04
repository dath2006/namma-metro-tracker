'use client';

import { useEffect, useState } from 'react';
import Aligner from './Aligner';

export default function AdminApp() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { fetch('/api/admin/login').then((r) => r.json()).then((d) => setAuthed(!!d.ok)); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const r = await fetch('/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) { setPassword(''); setAuthed(true); } else setError(d.error ?? 'Sign-in failed.');
  };

  if (authed === null) return <div className="grid h-screen place-items-center text-sm text-white/60">Loading…</div>;
  if (authed) return <Aligner onLogout={() => setAuthed(false)} />;
  return (
    <div className="grid h-screen place-items-center px-4">
      <form onSubmit={submit} className="glass w-full max-w-sm space-y-4 p-6">
        <div>
          <div className="text-lg font-semibold">Admin</div>
          <div className="text-xs text-white/60">Namma Metro tracker</div>
        </div>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoComplete="current-password"
          className="w-full rounded-lg bg-white/5 px-3 py-2.5 text-sm outline-none placeholder:text-white/40 focus:bg-white/10"
        />
        {error && <div className="text-xs text-red-300">{error}</div>}
        <button disabled={busy || !password} className="w-full rounded-lg bg-purple-600 px-3 py-2.5 text-sm font-semibold hover:bg-purple-500 disabled:opacity-40">
          {busy ? 'Checking…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
