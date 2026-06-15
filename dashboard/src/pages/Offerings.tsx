import { useState } from 'react';
import { useApi, type Offering, type Product } from '../api.ts';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner } from '../components/ui.tsx';
import { useResource } from '../lib/useResource.ts';

const STANDARD_PACKAGES = ['$rd_weekly', '$rd_monthly', '$rd_two_month', '$rd_three_month', '$rd_six_month', '$rd_annual', '$rd_lifetime'];

export function Offerings() {
  const { api } = useApi();
  const offerings = useResource<{ items: Offering[] }>(() => api.get('/v1/admin/offerings'));
  const products = useResource<{ items: Product[] }>(() => api.get('/v1/admin/products'));
  const [creating, setCreating] = useState(false);
  const productName = (id: string) => products.data?.items.find((p) => p.id === id)?.display_name ?? id;

  async function makeCurrent(o: Offering) {
    await api.patch(`/v1/admin/offerings/${o.id}`, { is_current: true });
    offerings.reload();
  }

  return (
    <>
      <PageHeader
        title="Offerings"
        subtitle="Paywall configurations served to your apps"
        actions={<Button onClick={() => setCreating(true)}>+ New offering</Button>}
      />
      {offerings.error && <p className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-300">{offerings.error}</p>}
      {offerings.loading ? (
        <Spinner />
      ) : !offerings.data?.items.length ? (
        <EmptyState title="No offerings yet" hint="Bundle your products into packages to show on a paywall." />
      ) : (
        <div className="space-y-4">
          {offerings.data.items.map((o) => (
            <Card key={o.id} className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-mono text-sm text-brand-400">{o.identifier}</p>
                    {o.is_current && <Badge tone="green">Current</Badge>}
                  </div>
                  <p className="mt-0.5 text-sm text-slate-400">{o.description || 'No description'}</p>
                </div>
                <div className="flex gap-2">
                  {!o.is_current && (
                    <Button variant="ghost" onClick={() => makeCurrent(o)}>
                      Make current
                    </Button>
                  )}
                  <Button
                    variant="danger"
                    onClick={async () => {
                      if (confirm(`Delete offering ${o.identifier}?`)) {
                        await api.delete(`/v1/admin/offerings/${o.id}`);
                        offerings.reload();
                      }
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {o.packages.map((pkg) => (
                  <div key={pkg.identifier} className="rounded-lg border border-white/5 bg-ink-950/60 p-3">
                    <p className="font-mono text-xs text-slate-300">{pkg.identifier}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {pkg.product_ids.map((pid) => (
                        <span key={pid} className="text-xs text-slate-500">
                          {productName(pid)}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
                {o.packages.length === 0 && <p className="text-sm text-slate-500">No packages</p>}
              </div>
            </Card>
          ))}
        </div>
      )}
      {creating && (
        <CreateOffering
          products={products.data?.items ?? []}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            offerings.reload();
          }}
        />
      )}
    </>
  );
}

interface DraftPackage {
  identifier: string;
  product_ids: string[];
}

function CreateOffering({
  products,
  onClose,
  onCreated,
}: {
  products: Product[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { api } = useApi();
  const [identifier, setIdentifier] = useState('default');
  const [description, setDescription] = useState('');
  const [isCurrent, setIsCurrent] = useState(true);
  const [packages, setPackages] = useState<DraftPackage[]>([{ identifier: '$rd_monthly', product_ids: [] }]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function updatePkg(i: number, patch: Partial<DraftPackage>) {
    setPackages((ps) => ps.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }
  function toggleProduct(i: number, pid: string) {
    setPackages((ps) =>
      ps.map((p, idx) =>
        idx === i ? { ...p, product_ids: p.product_ids.includes(pid) ? p.product_ids.filter((x) => x !== pid) : [...p.product_ids, pid] } : p,
      ),
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/v1/admin/offerings', {
        identifier,
        description,
        is_current: isCurrent,
        packages: packages.filter((p) => p.product_ids.length > 0),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
      setBusy(false);
    }
  }

  return (
    <Modal title="New offering" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Identifier">
            <Input value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="default" required />
          </Field>
          <Field label="Description">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Standard paywall" />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={isCurrent} onChange={(e) => setIsCurrent(e.target.checked)} className="accent-brand-500" />
          Set as the current offering
        </label>
        <div className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Packages</p>
          {packages.map((pkg, i) => (
            <div key={i} className="rounded-lg border border-white/10 p-3">
              <div className="mb-2 flex items-center gap-2">
                <Select value={pkg.identifier} onChange={(e) => updatePkg(i, { identifier: e.target.value })}>
                  {STANDARD_PACKAGES.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </Select>
                <Button variant="ghost" onClick={() => setPackages((ps) => ps.filter((_, idx) => idx !== i))}>
                  ✕
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {products.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggleProduct(i, p.id)}
                    className={`rounded-md px-2 py-1 text-xs transition ${
                      pkg.product_ids.includes(p.id) ? 'bg-brand-600 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'
                    }`}
                  >
                    {p.display_name} · {p.store === 'app_store' ? 'iOS' : 'Android'}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <Button variant="ghost" onClick={() => setPackages((ps) => [...ps, { identifier: '$rd_annual', product_ids: [] }])}>
            + Add package
          </Button>
        </div>
        {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create offering'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
