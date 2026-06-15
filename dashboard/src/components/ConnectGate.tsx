import { useState } from 'react';
import { ApiClient, type Connection } from '../api.ts';
import { Button, Field, Input } from './ui.tsx';

export function ConnectGate({ onConnect }: { onConnect: (c: Connection) => void }) {
  const [baseUrl, setBaseUrl] = useState('http://localhost:8787');
  const [secretKey, setSecretKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const conn = { baseUrl, secretKey };
    try {
      // Validate by hitting an admin endpoint.
      await new ApiClient(conn).get('/v1/admin/products');
      onConnect(conn);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mb-3 text-5xl">🐕</div>
          <h1 className="text-2xl font-semibold text-white">RevenueDog</h1>
          <p className="mt-1 text-sm text-slate-400">Open-source subscription analytics &amp; configuration</p>
        </div>
        <form onSubmit={connect} className="space-y-4 rounded-2xl border border-white/5 bg-ink-900/80 p-6">
          <Field label="Backend URL">
            <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://localhost:8787" />
          </Field>
          <Field label="Secret key (sk_…)">
            <Input
              value={secretKey}
              onChange={(e) => setSecretKey(e.target.value)}
              placeholder="sk_…"
              type="password"
              autoComplete="off"
            />
          </Field>
          {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
          <Button type="submit" disabled={busy || !secretKey} className="w-full justify-center">
            {busy ? 'Connecting…' : 'Connect'}
          </Button>
          <p className="text-center text-xs text-slate-500">
            The backend prints its secret key to the console on first run, or run <code className="text-slate-400">npm run seed</code>.
          </p>
        </form>
      </div>
    </div>
  );
}
