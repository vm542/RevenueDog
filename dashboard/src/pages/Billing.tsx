import { useApi, type Billing as BillingData } from '../api.ts';
import { useResource } from '../lib/useResource.ts';
import { Badge, Card, EmptyState, PageHeader, Spinner } from '../components/ui.tsx';
import { compactNumber } from '../lib/format.ts';

function UsageBar({ used, limit }: { used: number; limit: number | null }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const tone = pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-brand-500';
  return (
    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${limit ? pct : 100}%` }} />
    </div>
  );
}

function statusTone(status: string): 'green' | 'amber' | 'red' | 'slate' {
  if (status === 'active') return 'green';
  if (status === 'past_due') return 'amber';
  if (status === 'canceled') return 'red';
  return 'slate';
}

export function Billing() {
  const { api } = useApi();
  const { data, error, loading } = useResource<BillingData>(() => api.get('/v1/admin/billing'));

  if (loading) return <Spinner />;
  if (error || !data) return <EmptyState title="Could not load billing" hint={error ?? undefined} />;

  const { plan, usage, billing_status, over_limit } = data;

  return (
    <div>
      <PageHeader
        title="Billing & Usage"
        subtitle="Your plan and metered usage for this organization."
        actions={<Badge tone={statusTone(billing_status)}>{billing_status}</Badge>}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card className="p-5">
          <p className="text-xs uppercase tracking-wide text-slate-400">Plan</p>
          <p className="mt-1 text-2xl font-semibold text-white">{plan.name}</p>
          <p className="mt-1 text-sm text-slate-500">
            {plan.max_subscribers === null
              ? 'Unmetered subscribers'
              : `Up to ${compactNumber(plan.max_subscribers)} tracked subscribers`}
          </p>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-wide text-slate-400">Tracked subscribers</p>
            {over_limit && <Badge tone="red">over limit</Badge>}
          </div>
          <p className="mt-1 text-2xl font-semibold text-white">
            {compactNumber(usage.subscribers)}
            {plan.max_subscribers !== null && (
              <span className="text-sm font-normal text-slate-500"> / {compactNumber(plan.max_subscribers)}</span>
            )}
          </p>
          <UsageBar used={usage.subscribers} limit={plan.max_subscribers} />
        </Card>

        <Card className="p-5">
          <p className="text-xs uppercase tracking-wide text-slate-400">Events (30 days)</p>
          <p className="mt-1 text-2xl font-semibold text-white">{compactNumber(usage.events_30d)}</p>
          <p className="mt-1 text-sm text-slate-500">Purchases, renewals, expirations & more</p>
        </Card>
      </div>

      <Card className="mt-4 p-5">
        <p className="text-sm text-slate-300">
          {over_limit
            ? 'You are over your plan limit. Usage is never blocked — upgrade to raise your included subscribers.'
            : 'You are within your plan limits.'}
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Upgrades are handled via Stripe Checkout on the hosted version. Self-hosted instances are unmetered.
        </p>
      </Card>
    </div>
  );
}
