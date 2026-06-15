import { useState } from 'react';
import { EVENT_TYPES, useApi, type Webhook, type WebhookDelivery, type EventRow } from '../api.ts';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Spinner } from '../components/ui.tsx';
import { useResource } from '../lib/useResource.ts';
import { dateTime, money } from '../lib/format.ts';

export function Webhooks() {
  const { api } = useApi();
  const hooks = useResource<{ items: Webhook[] }>(() => api.get('/v1/admin/webhooks'));
  const events = useResource<{ items: EventRow[] }>(() => api.get('/v1/admin/events?limit=30'));
  const [creating, setCreating] = useState(false);
  const [deliveriesFor, setDeliveriesFor] = useState<Webhook | null>(null);

  return (
    <>
      <PageHeader
        title="Webhooks & Events"
        subtitle="Get notified of purchases, renewals, and expirations"
        actions={<Button onClick={() => setCreating(true)}>+ Add webhook</Button>}
      />
      {hooks.error && <p className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-300">{hooks.error}</p>}

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-3 lg:col-span-3">
          <h3 className="text-sm font-medium text-slate-300">Endpoints</h3>
          {hooks.loading ? (
            <Spinner />
          ) : !hooks.data?.items.length ? (
            <EmptyState title="No webhooks" hint="Add an endpoint to receive event notifications." />
          ) : (
            hooks.data.items.map((wh) => (
              <Card key={wh.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge tone={wh.active ? 'green' : 'slate'}>{wh.active ? 'Active' : 'Paused'}</Badge>
                      <span className="truncate font-mono text-xs text-slate-300">{wh.url}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {wh.events === '*' ? (
                        <Badge tone="indigo">all events</Badge>
                      ) : (
                        wh.events.map((e) => (
                          <Badge key={e} tone="slate">
                            {e}
                          </Badge>
                        ))
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button variant="ghost" onClick={async () => {
                      await api.post(`/v1/admin/webhooks/${wh.id}/test`);
                      setTimeout(() => events.reload(), 600);
                    }}>
                      Test
                    </Button>
                    <Button variant="ghost" onClick={() => setDeliveriesFor(wh)}>
                      Logs
                    </Button>
                    <Button
                      variant="danger"
                      onClick={async () => {
                        if (confirm('Delete webhook?')) {
                          await api.delete(`/v1/admin/webhooks/${wh.id}`);
                          hooks.reload();
                        }
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>

        <div className="lg:col-span-2">
          <h3 className="mb-3 text-sm font-medium text-slate-300">Recent events</h3>
          <Card className="divide-y divide-white/5">
            {events.data?.items.length ? (
              events.data.items.map((e) => (
                <div key={e.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <div className="min-w-0">
                    <Badge tone="indigo">{e.type}</Badge>
                    <span className="ml-2 font-mono text-xs text-slate-500">{e.app_user_id}</span>
                  </div>
                  <span className="shrink-0 text-xs text-slate-500">
                    {e.price ? money(e.price, e.currency ?? 'USD') : dateTime(e.created_at)}
                  </span>
                </div>
              ))
            ) : (
              <p className="px-4 py-6 text-center text-sm text-slate-500">No events yet.</p>
            )}
          </Card>
        </div>
      </div>

      {creating && (
        <CreateWebhook
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            hooks.reload();
          }}
        />
      )}
      {deliveriesFor && <Deliveries webhook={deliveriesFor} onClose={() => setDeliveriesFor(null)} />}
    </>
  );
}

function CreateWebhook({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { api } = useApi();
  const [url, setUrl] = useState('');
  const [allEvents, setAllEvents] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api.post<Webhook>('/v1/admin/webhooks', {
        url,
        events: allEvents ? '*' : selected,
      });
      setSecret(created.secret);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
      setBusy(false);
    }
  }

  if (secret) {
    return (
      <Modal title="Webhook created" onClose={onCreated}>
        <p className="text-sm text-slate-400">Use this signing secret to verify the <code>X-RevenueDog-Signature</code> header (HMAC-SHA256):</p>
        <p className="mt-3 break-all rounded-lg border border-white/10 bg-ink-950 p-3 font-mono text-xs text-emerald-300">{secret}</p>
        <div className="mt-4 flex justify-end">
          <Button onClick={onCreated}>Done</Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Add webhook" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Endpoint URL">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-server.com/webhooks/revenuedog" required />
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={allEvents} onChange={(e) => setAllEvents(e.target.checked)} className="accent-brand-500" />
          Send all event types
        </label>
        {!allEvents && (
          <div className="flex flex-wrap gap-2">
            {EVENT_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setSelected((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]))}
                className={`rounded-md px-2 py-1 text-xs transition ${
                  selected.includes(t) ? 'bg-brand-600 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        )}
        {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !url}>
            {busy ? 'Creating…' : 'Create'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Deliveries({ webhook, onClose }: { webhook: Webhook; onClose: () => void }) {
  const { api } = useApi();
  const { data, loading } = useResource<{ items: WebhookDelivery[] }>(() =>
    api.get(`/v1/admin/webhooks/${webhook.id}/deliveries`),
  );
  return (
    <Modal title="Delivery log" onClose={onClose}>
      {loading ? (
        <Spinner />
      ) : !data?.items.length ? (
        <p className="py-6 text-center text-sm text-slate-500">No deliveries yet. Hit “Test” to send one.</p>
      ) : (
        <div className="max-h-96 space-y-1 overflow-y-auto">
          {data.items.map((d) => (
            <div key={d.id} className="flex items-center justify-between rounded-lg border border-white/5 px-3 py-2 text-sm">
              <div>
                <Badge tone={d.ok ? 'green' : 'red'}>{d.ok ? `${d.status_code ?? 'OK'}` : 'failed'}</Badge>
                <span className="ml-2 text-slate-300">{d.event_type}</span>
              </div>
              <span className="text-xs text-slate-500">{dateTime(d.created_at)}</span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
