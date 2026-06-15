import { useState } from 'react';
import { useApi, type Product } from '../api.ts';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner } from '../components/ui.tsx';
import { useResource } from '../lib/useResource.ts';
import { durationLabel } from '../lib/format.ts';

export function Products() {
  const { api } = useApi();
  const { data, loading, error, reload } = useResource<{ items: Product[] }>(() => api.get('/v1/admin/products'));
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);

  return (
    <>
      <PageHeader
        title="Products"
        subtitle="Store products synced from App Store Connect / Play Console"
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setImporting(true)}>
              Import
            </Button>
            <Button onClick={() => setCreating(true)}>+ New product</Button>
          </div>
        }
      />
      {error && <p className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</p>}
      {loading ? (
        <Spinner />
      ) : !data?.items.length ? (
        <EmptyState title="No products yet" hint="Add the products you sell in the stores." />
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">Product</th>
                <th className="px-5 py-3 font-medium">Identifier</th>
                <th className="px-5 py-3 font-medium">Store</th>
                <th className="px-5 py-3 font-medium">Type</th>
                <th className="px-5 py-3 font-medium">Billing</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {data.items.map((p) => (
                <tr key={p.id} className="text-slate-300">
                  <td className="px-5 py-3 font-medium text-white">{p.display_name}</td>
                  <td className="px-5 py-3 font-mono text-xs text-slate-400">{p.store_identifier}</td>
                  <td className="px-5 py-3">{p.store === 'app_store' ? '🍎 App Store' : '🤖 Play'}</td>
                  <td className="px-5 py-3">
                    <Badge tone="slate">{p.type}</Badge>
                  </td>
                  <td className="px-5 py-3 text-slate-400">{durationLabel(p.duration)}</td>
                  <td className="px-5 py-3 text-right">
                    <Button
                      variant="danger"
                      onClick={async () => {
                        if (confirm(`Delete ${p.display_name}?`)) {
                          await api.delete(`/v1/admin/products/${p.id}`);
                          reload();
                        }
                      }}
                    >
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {creating && (
        <CreateProduct
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            reload();
          }}
        />
      )}
      {importing && (
        <ImportProducts
          onClose={() => setImporting(false)}
          onImported={() => {
            setImporting(false);
            reload();
          }}
        />
      )}
    </>
  );
}

function ImportProducts({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const { api } = useApi();
  const [csv, setCsv] = useState(
    'com.app.pro.monthly,subscription,app_store,Pro Monthly,P1M\ncom.app.pro.annual,subscription,app_store,Pro Annual,P1Y',
  );
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function parseCsv() {
    return csv
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const [store_identifier, type, store, display_name, duration] = line.split(',').map((s) => s.trim());
        return {
          store_identifier,
          type: type || 'subscription',
          store: store || 'app_store',
          display_name: display_name || store_identifier,
          duration: duration || null,
        };
      });
  }

  async function importCsv() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.post<{ imported: number; skipped: number; failed: unknown[] }>('/v1/admin/products/import', {
        products: parseCsv(),
      });
      setResult(`Imported ${res.imported}, skipped ${res.skipped}, failed ${res.failed.length}.`);
      if (res.imported > 0) setTimeout(onImported, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function importFromStore(store: 'app_store' | 'play_store') {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.post<{ imported: number }>(`/v1/admin/products/import/${store}`);
      setResult(`Imported ${res.imported} from ${store}.`);
      setTimeout(onImported, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Import products" onClose={onClose}>
      <div className="space-y-4">
        <Field label="CSV — store_identifier,type,store,display_name,duration">
          <textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            rows={6}
            className="w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 font-mono text-xs text-slate-100 outline-none focus:border-brand-500"
          />
        </Field>
        <div className="flex gap-2">
          <Button onClick={importCsv} disabled={busy}>
            {busy ? 'Importing…' : 'Import CSV'}
          </Button>
          <Button variant="ghost" onClick={() => importFromStore('app_store')} disabled={busy}>
            From App Store
          </Button>
          <Button variant="ghost" onClick={() => importFromStore('play_store')} disabled={busy}>
            From Play
          </Button>
        </div>
        {result && <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{result}</p>}
        {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
        <p className="text-xs text-slate-500">
          “From App Store / Play” pulls your catalog directly once store credentials are configured on the backend.
        </p>
      </div>
    </Modal>
  );
}

function CreateProduct({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { api } = useApi();
  const [form, setForm] = useState({
    store_identifier: '',
    display_name: '',
    type: 'subscription',
    store: 'app_store',
    duration: 'P1M',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isSub = form.type === 'subscription';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/v1/admin/products', {
        store_identifier: form.store_identifier,
        display_name: form.display_name,
        type: form.type,
        store: form.store,
        duration: isSub ? form.duration : null,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
      setBusy(false);
    }
  }

  return (
    <Modal title="New product" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Display name">
          <Input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} placeholder="Pro Monthly" required />
        </Field>
        <Field label="Store identifier">
          <Input value={form.store_identifier} onChange={(e) => setForm({ ...form, store_identifier: e.target.value })} placeholder="com.app.pro.monthly" required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Store">
            <Select value={form.store} onChange={(e) => setForm({ ...form, store: e.target.value })}>
              <option value="app_store">App Store</option>
              <option value="play_store">Play Store</option>
            </Select>
          </Field>
          <Field label="Type">
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="subscription">Subscription</option>
              <option value="non_consumable">Non-consumable</option>
              <option value="consumable">Consumable</option>
            </Select>
          </Field>
        </div>
        {isSub && (
          <Field label="Billing period">
            <Select value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })}>
              <option value="P1W">Weekly</option>
              <option value="P1M">Monthly</option>
              <option value="P2M">2 Months</option>
              <option value="P3M">3 Months</option>
              <option value="P6M">6 Months</option>
              <option value="P1Y">Yearly</option>
            </Select>
          </Field>
        )}
        {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create product'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
