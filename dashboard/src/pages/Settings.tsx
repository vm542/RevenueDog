import { useState } from 'react';
import { useApi, type AppRow } from '../api.ts';
import { Button, Card, EmptyState, Field, Input, Modal, PageHeader, Spinner } from '../components/ui.tsx';
import { useResource } from '../lib/useResource.ts';

export function Settings() {
  const { api, conn } = useApi();
  const { data, loading, error, reload } = useResource<{ items: AppRow[] }>(() => api.get('/v1/admin/apps'));
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

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
        <h3 className="text-sm font-medium text-slate-300">Connection</h3>
        <p className="mt-2 text-sm text-slate-500">
          Connected to <span className="font-mono text-slate-300">{conn.baseUrl}</span> with a secret key. The secret key is
          stored in your browser only and never leaves it except to call this backend.
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
