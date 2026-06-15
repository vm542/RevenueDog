import { useState } from 'react';
import { useApi, type AppRow, type Diagnostics } from '../api.ts';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Spinner } from '../components/ui.tsx';
import { useResource } from '../lib/useResource.ts';
import { relativeTime } from '../lib/format.ts';

export function Settings() {
  const { api, conn } = useApi();
  const { data, loading, error, reload } = useResource<{ items: AppRow[] }>(() => api.get('/v1/admin/apps'));
  const diag = useResource<Diagnostics>(() => api.get('/v1/admin/diagnostics'));
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const diagFor = (id: string) => diag.data?.apps.find((a) => a.id === id);

  function copy(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(text);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <>
      <PageHeader
        title="Apps & Keys"
        subtitle="Public SDK keys for your mobile apps"
        actions={<Button onClick={() => setCreating(true)}>+ New app</Button>}
      />
      {error && <p className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</p>}
      {loading ? (
        <Spinner />
      ) : !data?.items.length ? (
        <EmptyState title="No apps yet" hint="Create an app to get a public SDK key (pk_…)." />
      ) : (
        <div className="space-y-3">
          {data.items.map((app) => (
            <Card key={app.id} className="p-5">
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-white">{app.name}</p>
                  <p className="text-xs text-slate-500">{app.bundle_id || app.package_name || 'no bundle id'}</p>
                  <button
                    onClick={() => copy(app.public_api_key)}
                    className="mt-3 flex items-center gap-2 rounded-lg border border-white/10 bg-ink-950 px-3 py-2 font-mono text-xs text-slate-300 transition hover:border-brand-500"
                  >
                    {app.public_api_key}
                    <span className="text-slate-500">{copied === app.public_api_key ? '✓ copied' : '📋'}</span>
                  </button>
                  <div className="mt-3">
                    {(() => {
                      const d = diagFor(app.id);
                      if (!d || !d.connected) {
                        return (
                          <div className="flex items-center gap-2 text-xs text-slate-500">
                            <span className="h-2 w-2 rounded-full bg-slate-600" />
                            Waiting for first SDK call…
                          </div>
                        );
                      }
                      return (
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 text-xs text-emerald-300">
                            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                            SDK connected · last seen {relativeTime(d.last_seen)}
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {d.platforms.map((p) => (
                              <Badge key={p.platform} tone="slate">
                                {p.platform === 'ios' ? '🍎' : '🤖'} {p.platform} · SDK {p.sdk_version ?? '?'} · {p.request_count} reqs
                              </Badge>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
                <Button
                  variant="danger"
                  onClick={async () => {
                    if (confirm(`Delete app ${app.name}? Its SDK key will stop working.`)) {
                      await api.delete(`/v1/admin/apps/${app.id}`);
                      reload();
                    }
                  }}
                >
                  Delete
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Card className="mt-6 p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-slate-300">System &amp; diagnostics</h3>
          <a
            href={`${conn.baseUrl.replace(/\/$/, '')}/docs`}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-brand-400 hover:text-brand-300"
          >
            📖 API docs →
          </a>
        </div>
        {diag.data && (
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Diag label="Backend" value={`v${diag.data.backend_version}`} />
            <Diag label="Apple validation" value={diag.data.validation.app_store} />
            <Diag label="Google validation" value={diag.data.validation.play_store} />
            <Diag label="Events" value={`${diag.data.totals.events}`} />
            <Diag label="Products" value={`${diag.data.totals.products}`} />
            <Diag label="Entitlements" value={`${diag.data.totals.entitlements}`} />
            <Diag label="Offerings" value={`${diag.data.totals.offerings}`} />
            <Diag label="Subscribers" value={`${diag.data.totals.subscribers}`} />
          </div>
        )}
        <p className="mt-4 text-sm text-slate-500">
          Connected to <span className="font-mono text-slate-300">{conn.baseUrl}</span>. The secret key is stored in your
          browser only and never leaves it except to call this backend.
        </p>
      </Card>

      {creating && (
        <CreateApp
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            reload();
          }}
        />
      )}
    </>
  );
}

function Diag({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/5 bg-ink-950/60 p-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 font-medium text-slate-200">{value}</p>
    </div>
  );
}

function CreateApp({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { api } = useApi();
  const [form, setForm] = useState({ name: '', bundle_id: '', package_name: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/v1/admin/apps', {
        name: form.name,
        bundle_id: form.bundle_id || null,
        package_name: form.package_name || null,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
      setBusy(false);
    }
  }

  return (
    <Modal title="New app" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="App name">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="My App" required />
        </Field>
        <Field label="Bundle ID (iOS)">
          <Input value={form.bundle_id} onChange={(e) => setForm({ ...form, bundle_id: e.target.value })} placeholder="com.company.app" />
        </Field>
        <Field label="Package name (Android)">
          <Input value={form.package_name} onChange={(e) => setForm({ ...form, package_name: e.target.value })} placeholder="com.company.app" />
        </Field>
        {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create app'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
