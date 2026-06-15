import { useState } from 'react';
import { useApi, type Entitlement, type Product } from '../api.ts';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Spinner } from '../components/ui.tsx';
import { useResource } from '../lib/useResource.ts';

export function Entitlements() {
  const { api } = useApi();
  const ents = useResource<{ items: Entitlement[] }>(() => api.get('/v1/admin/entitlements'));
  const products = useResource<{ items: Product[] }>(() => api.get('/v1/admin/products'));
  const [creating, setCreating] = useState(false);

  const productName = (id: string) => products.data?.items.find((p) => p.id === id)?.display_name ?? id;

  return (
    <>
      <PageHeader
        title="Entitlements"
        subtitle="Access levels unlocked by owning one or more products"
        actions={<Button onClick={() => setCreating(true)}>+ New entitlement</Button>}
      />
      {ents.error && <p className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-300">{ents.error}</p>}
      {ents.loading ? (
        <Spinner />
      ) : !ents.data?.items.length ? (
        <EmptyState title="No entitlements yet" hint="Create an entitlement like ‘pro’ and attach products." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {ents.data.items.map((e) => (
            <Card key={e.id} className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-mono text-sm text-brand-400">{e.identifier}</p>
                  <p className="mt-0.5 text-white">{e.display_name}</p>
                </div>
                <Button
                  variant="danger"
                  onClick={async () => {
                    if (confirm(`Delete entitlement ${e.identifier}?`)) {
                      await api.delete(`/v1/admin/entitlements/${e.id}`);
                      ents.reload();
                    }
                  }}
                >
                  Delete
                </Button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {e.product_ids.length === 0 && <span className="text-sm text-slate-500">No products attached</span>}
                {e.product_ids.map((pid) => (
                  <Badge key={pid} tone="slate">
                    {productName(pid)}
                  </Badge>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
      {creating && (
        <CreateEntitlement
          products={products.data?.items ?? []}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            ents.reload();
          }}
        />
      )}
    </>
  );
}

function CreateEntitlement({
  products,
  onClose,
  onCreated,
}: {
  products: Product[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { api } = useApi();
  const [identifier, setIdentifier] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/v1/admin/entitlements', {
        identifier,
        display_name: displayName,
        product_ids: selected,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
      setBusy(false);
    }
  }

  return (
    <Modal title="New entitlement" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Identifier">
          <Input value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="pro" required />
        </Field>
        <Field label="Display name">
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Pro access" required />
        </Field>
        <Field label="Products">
          <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-white/10 p-2">
            {products.length === 0 && <p className="px-1 py-2 text-sm text-slate-500">No products. Create products first.</p>}
            {products.map((p) => (
              <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-white/5">
                <input type="checkbox" checked={selected.includes(p.id)} onChange={() => toggle(p.id)} className="accent-brand-500" />
                <span className="text-slate-200">{p.display_name}</span>
                <span className="text-xs text-slate-500">{p.store === 'app_store' ? 'iOS' : 'Android'}</span>
              </label>
            ))}
          </div>
        </Field>
        {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
