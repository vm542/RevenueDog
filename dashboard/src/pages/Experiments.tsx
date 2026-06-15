import { useState } from 'react';
import { useApi, type Experiment, type ExperimentResults, type Offering } from '../api.ts';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select, Spinner } from '../components/ui.tsx';
import { useResource } from '../lib/useResource.ts';
import { money } from '../lib/format.ts';

export function Experiments() {
  const { api } = useApi();
  const experiments = useResource<{ items: Experiment[] }>(() => api.get('/v1/admin/experiments'));
  const offerings = useResource<{ items: Offering[] }>(() => api.get('/v1/admin/offerings'));
  const [creating, setCreating] = useState(false);
  const offeringName = (id: string) => offerings.data?.items.find((o) => o.id === id)?.identifier ?? id;

  return (
    <>
      <PageHeader
        title="Experiments"
        subtitle="A/B test paywalls and measure conversion"
        actions={<Button onClick={() => setCreating(true)}>+ New experiment</Button>}
      />
      {experiments.error && <p className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-300">{experiments.error}</p>}
      {experiments.loading ? (
        <Spinner />
      ) : !experiments.data?.items.length ? (
        <EmptyState title="No experiments yet" hint="Test an annual-first paywall against your default." />
      ) : (
        <div className="space-y-4">
          {experiments.data.items.map((e) => (
            <ExperimentCard key={e.id} exp={e} offeringName={offeringName} onChange={experiments.reload} />
          ))}
        </div>
      )}
      {creating && (
        <CreateExperiment
          offerings={offerings.data?.items ?? []}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            experiments.reload();
          }}
        />
      )}
    </>
  );
}

function ExperimentCard({
  exp,
  offeringName,
  onChange,
}: {
  exp: Experiment;
  offeringName: (id: string) => string;
  onChange: () => void;
}) {
  const { api } = useApi();
  const results = useResource<ExperimentResults>(() => api.get(`/v1/admin/experiments/${exp.id}/results`), [exp.id]);
  const tone = exp.status === 'running' ? 'green' : exp.status === 'stopped' ? 'red' : 'amber';

  const conv = (r: { enrolled: number; purchases: number }) => (r.enrolled ? ((r.purchases / r.enrolled) * 100).toFixed(1) : '0.0');

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <p className="font-medium text-white">{exp.name}</p>
            <Badge tone={tone}>{exp.status}</Badge>
          </div>
          <p className="mt-0.5 text-sm text-slate-400">
            {exp.traffic_pct}% traffic → <span className="font-mono">{offeringName(exp.treatment_offering_id)}</span> vs{' '}
            <span className="font-mono">{offeringName(exp.control_offering_id)}</span>
          </p>
        </div>
        {exp.status === 'running' && (
          <Button
            variant="ghost"
            onClick={async () => {
              await api.post(`/v1/admin/experiments/${exp.id}/stop`);
              onChange();
            }}
          >
            Stop
          </Button>
        )}
      </div>
      {results.data && (
        <div className="mt-4 grid grid-cols-2 gap-3">
          {(['control', 'treatment'] as const).map((variant) => {
            const r = results.data![variant];
            return (
              <div key={variant} className="rounded-lg border border-white/5 bg-ink-950/60 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-400">{variant}</p>
                <p className="mt-1 text-2xl font-semibold text-white">{conv(r)}%</p>
                <p className="text-xs text-slate-500">conversion</p>
                <div className="mt-2 flex justify-between text-xs text-slate-400">
                  <span>{r.enrolled} enrolled</span>
                  <span>{r.purchases} purchases</span>
                  <span>{money(r.revenue)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function CreateExperiment({
  offerings,
  onClose,
  onCreated,
}: {
  offerings: Offering[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { api } = useApi();
  const [form, setForm] = useState({
    name: '',
    control_offering_id: offerings[0]?.id ?? '',
    treatment_offering_id: offerings[1]?.id ?? offerings[0]?.id ?? '',
    traffic_pct: 50,
    status: 'running',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/v1/admin/experiments', form);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
      setBusy(false);
    }
  }

  return (
    <Modal title="New experiment" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Name">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Annual-first paywall" required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Control offering">
            <Select value={form.control_offering_id} onChange={(e) => setForm({ ...form, control_offering_id: e.target.value })}>
              {offerings.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.identifier}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Treatment offering">
            <Select value={form.treatment_offering_id} onChange={(e) => setForm({ ...form, treatment_offering_id: e.target.value })}>
              {offerings.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.identifier}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={`Traffic to treatment: ${form.traffic_pct}%`}>
          <input
            type="range"
            min={0}
            max={100}
            value={form.traffic_pct}
            onChange={(e) => setForm({ ...form, traffic_pct: Number(e.target.value) })}
            className="w-full accent-brand-500"
          />
        </Field>
        <Field label="Status">
          <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value="draft">Draft</option>
            <option value="running">Running</option>
          </Select>
        </Field>
        {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || offerings.length < 1}>
            {busy ? 'Creating…' : 'Create'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
