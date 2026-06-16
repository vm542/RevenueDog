import { useState } from 'react';
import { ApiClient, login, signup, type Connection, type Me } from '../api.ts';
import { Button, Field, Input } from './ui.tsx';

type Mode = 'login' | 'signup' | 'key';

export function ConnectGate({ onConnect }: { onConnect: (c: Connection) => void }) {
  const [mode, setMode] = useState<Mode>('login');
  const [baseUrl, setBaseUrl] = useState('http://localhost:8787');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'key') {
        const conn: Connection = { baseUrl, mode: 'key', secretKey };
        await new ApiClient(conn).get('/v1/admin/products');
        onConnect(conn);
        return;
      }
      if (mode === 'signup') {
        const res = await signup(baseUrl, email, password);
        onConnect({
          baseUrl,
          mode: 'session',
          sessionToken: res.token,
          projectId: res.project.id,
          email: res.user.email,
        });
        return;
      }
      // login
      const { token } = await login(baseUrl, email, password);
      const me = await new ApiClient({ baseUrl, mode: 'session', sessionToken: token }).get<Me>('/v1/auth/me');
      const projectId = me.projects[0]?.id;
      if (!projectId) throw new Error('Your account has no projects yet.');
      onConnect({ baseUrl, mode: 'session', sessionToken: token, projectId, email: me.user.email });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  const tab = (m: Mode, label: string) => (
    <button
      type="button"
      onClick={() => {
        setMode(m);
        setError(null);
      }}
      className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
        mode === m ? 'bg-brand-600 text-white' : 'text-slate-400 hover:bg-white/5'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mb-3 text-5xl">🐕</div>
          <h1 className="text-2xl font-semibold text-white">RevenueDog</h1>
          <p className="mt-1 text-sm text-slate-400">Open-source subscription analytics &amp; configuration</p>
        </div>

        <div className="mb-4 flex gap-1 rounded-xl border border-white/5 bg-ink-900/80 p-1">
          {tab('login', 'Sign in')}
          {tab('signup', 'Create account')}
          {tab('key', 'Self-host key')}
        </div>

        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-white/5 bg-ink-900/80 p-6">
          <Field label="Backend URL">
            <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://localhost:8787" />
          </Field>

          {mode === 'key' ? (
            <Field label="Secret key (sk_…)">
              <Input
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
                placeholder="sk_…"
                type="password"
                autoComplete="off"
              />
            </Field>
          ) : (
            <>
              <Field label="Email">
                <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="you@example.com" />
              </Field>
              <Field label="Password">
                <Input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type="password"
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  placeholder={mode === 'signup' ? 'At least 8 characters' : '••••••••'}
                />
              </Field>
            </>
          )}

          {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}

          <Button
            type="submit"
            disabled={busy || (mode === 'key' ? !secretKey : !email || !password)}
            className="w-full justify-center"
          >
            {busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : mode === 'login' ? 'Sign in' : 'Connect'}
          </Button>

          <p className="text-center text-xs text-slate-500">
            {mode === 'key'
              ? 'Self-hosting? The backend prints its secret key on first run (or run npm run seed).'
              : 'Hosted accounts: sign up to get a project and API keys instantly.'}
          </p>
        </form>
      </div>
    </div>
  );
}
