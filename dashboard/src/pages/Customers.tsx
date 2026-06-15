import { useState } from 'react';
import { useApi, type Entitlement, type SubscriberSummary } from '../api.ts';
import { Badge, Button, Card, EmptyState, Modal, PageHeader, Select, Spinner } from '../components/ui.tsx';
import { useResource } from '../lib/useResource.ts';
import { dateTime } from '../lib/format.ts';

interface CustomerInfo {
  subscriber: {
    original_app_user_id: string;
    first_seen: string;
    last_seen: string;
    entitlements: Record<string, { expires_date: string | null; product_identifier: string }>;
    subscriptions: Record<string, { expires_date: string | null; store: string; period_type: string; will_renew: boolean }>;
    subscriber_attributes: Record<string, { value: string }>;
  };
}

export function Customers() {
  const { api } = useApi();
  const { data, loading, error, reload } = useResource<{ items: SubscriberSummary[] }>(() =>
    api.get('/v1/admin/subscribers?limit=200'),
  );
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <>
      <PageHeader title="Customers" subtitle="Everyone who has launched your app" />
      {error && <p className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</p>}
      {loading ? (
        <Spinner />
      ) : !data?.items.length ? (
        <EmptyState title="No customers yet" hint="They appear here the first time your app calls the SDK." />
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">App User ID</th>
                <th className="px-5 py-3 font-medium">Entitlements</th>
                <th className="px-5 py-3 font-medium">First seen</th>
                <th className="px-5 py-3 font-medium">Last seen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {data.items.map((s) => (
                <tr
                  key={s.id}
                  onClick={() => setSelected(s.original_app_user_id)}
                  className="cursor-pointer text-slate-300 transition hover:bg-white/5"
                >
                  <td className="px-5 py-3 font-mono text-xs text-slate-300">{s.original_app_user_id}</td>
                  <td className="px-5 py-3">
                    {s.active_entitlements.length ? (
                      <div className="flex flex-wrap gap-1">
                        {s.active_entitlements.map((e) => (
                          <Badge key={e} tone="indigo">
                            {e}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-slate-600">Free</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-slate-500">{dateTime(s.first_seen)}</td>
                  <td className="px-5 py-3 text-slate-500">{dateTime(s.last_seen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {selected && (
        <CustomerDetail
          appUserId={selected}
          onClose={() => setSelected(null)}
          onMutate={() => {
            reload();
          }}
        />
      )}
    </>
  );
}

function CustomerDetail({ appUserId, onClose, onMutate }: { appUserId: string; onClose: () => void; onMutate: () => void }) {
  const { api } = useApi();
  const info = useResource<CustomerInfo>(() => api.get(`/v1/admin/subscribers/${encodeURIComponent(appUserId)}`), [appUserId]);
  const ents = useResource<{ items: Entitlement[] }>(() => api.get('/v1/admin/entitlements'));
  const [grantId, setGrantId] = useState('');

  async function grant() {
    const ent = ents.data?.items.find((e) => e.id === grantId);
    if (!ent) return;
    await api.post(`/v1/admin/subscribers/${encodeURIComponent(appUserId)}/entitlements/${ent.identifier}/grant`, {
      expires_date: null,
    });
    info.reload();
    onMutate();
  }
  async function revoke(identifier: string) {
    await api.post(`/v1/admin/subscribers/${encodeURIComponent(appUserId)}/entitlements/${identifier}/revoke`, {});
    info.reload();
    onMutate();
  }

  const sub = info.data?.subscriber;

  return (
    <Modal title={appUserId} onClose={onClose}>
      {info.loading || !sub ? (
        <Spinner />
      ) : (
        <div className="space-y-5">
          <section>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Active entitlements</h3>
            {Object.keys(sub.entitlements).length === 0 ? (
              <p className="text-sm text-slate-500">None</p>
            ) : (
              <div className="space-y-2">
                {Object.entries(sub.entitlements).map(([id, e]) => (
                  <div key={id} className="flex items-center justify-between rounded-lg border border-white/5 bg-ink-950/60 px-3 py-2">
                    <div>
                      <Badge tone="green">{id}</Badge>
                      <span className="ml-2 text-xs text-slate-500">
                        {e.expires_date ? `expires ${dateTime(e.expires_date)}` : 'lifetime'}
                      </span>
                    </div>
                    <Button variant="danger" onClick={() => revoke(id)}>
                      Revoke
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="flex items-end gap-2">
            <div className="flex-1">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">Grant entitlement</span>
              <Select value={grantId} onChange={(e) => setGrantId(e.target.value)}>
                <option value="">Select…</option>
                {ents.data?.items.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.identifier}
                  </option>
                ))}
              </Select>
            </div>
            <Button onClick={grant} disabled={!grantId}>
              Grant
            </Button>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Subscriptions</h3>
            {Object.keys(sub.subscriptions).length === 0 ? (
              <p className="text-sm text-slate-500">None</p>
            ) : (
              <div className="space-y-1.5">
                {Object.entries(sub.subscriptions).map(([pid, s]) => (
                  <div key={pid} className="flex justify-between rounded-lg border border-white/5 px-3 py-2 text-sm">
                    <span className="font-mono text-xs text-slate-300">{pid}</span>
                    <span className="text-slate-500">
                      {s.period_type} · {s.expires_date ? dateTime(s.expires_date) : 'lifetime'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {Object.keys(sub.subscriber_attributes).length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Attributes</h3>
              <div className="space-y-1 text-sm">
                {Object.entries(sub.subscriber_attributes).map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span className="text-slate-400">{k}</span>
                    <span className="text-slate-300">{v.value}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}
