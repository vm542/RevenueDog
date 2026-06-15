import { useState } from 'react';
import { useApi, type Product } from '../api.ts';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner } from '../components/ui.tsx';
import { useResource } from '../lib/useResource.ts';
import { durationLabel } from '../lib/format.ts';

export function Products() {
  const { api } = useApi();
  const { data, loading, error, reload } = useResource<{ items: Product[] }>(() => api.get('/v1/admin/products'));
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader
        title="Products"
        subtitle="Store products synced from App Store Connect / Play Console"
        actions={<Button onClick={() => setCreating(true)}>+ New product</Button>}
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
    </>
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
