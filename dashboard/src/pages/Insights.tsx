import { useApi, type Insights as InsightsData } from '../api.ts';
import { Card, PageHeader, Spinner } from '../components/ui.tsx';
import { useResource } from '../lib/useResource.ts';
import { money } from '../lib/format.ts';

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-white">{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </Card>
  );
}

export function Insights() {
  const { api } = useApi();
  const { data, loading, error } = useResource<InsightsData>(() => api.get('/v1/admin/insights'));

  return (
    <>
      <PageHeader title="Insights" subtitle="Conversion, lifetime value, and retention cohorts" />
      {error && <p className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</p>}
      {loading || !data ? (
        <Spinner />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="ARPU" value={money(data.ltv.arpu)} sub="Avg revenue / customer" />
            <Stat label="ARPPU" value={money(data.ltv.arppu)} sub="Avg revenue / paying customer" />
            <Stat label="Paying customers" value={`${data.ltv.paying_customers}`} sub={`of ${data.ltv.total_customers} total`} />
            <Stat
              label="Trial conversion"
              value={`${data.trial_conversion.rate}%`}
              sub={`${data.trial_conversion.converted}/${data.trial_conversion.trials} trials`}
            />
          </div>

          <Card className="p-6">
            <h3 className="mb-5 text-sm font-medium text-slate-300">Conversion funnel</h3>
            <div className="space-y-3">
              {data.funnel.map((stage) => {
                const top = data.funnel[0]?.count || 1;
                const pct = (stage.count / top) * 100;
                return (
                  <div key={stage.stage}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span className="text-slate-300">{stage.stage}</span>
                      <span className="text-slate-400">
                        {stage.count} <span className="text-slate-600">({pct.toFixed(0)}%)</span>
                      </span>
                    </div>
                    <div className="h-6 overflow-hidden rounded-md bg-white/5">
                      <div
                        className="flex h-full items-center justify-end rounded-md bg-gradient-to-r from-brand-600 to-brand-400 pr-2 text-xs text-white/90"
                        style={{ width: `${Math.max(pct, 4)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="mb-4 text-sm font-medium text-slate-300">Signup cohorts (monthly)</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="pb-2 font-medium">Cohort</th>
                  <th className="pb-2 text-right font-medium">Customers</th>
                  <th className="pb-2 text-right font-medium">Paying</th>
                  <th className="pb-2 text-right font-medium">Revenue</th>
                  <th className="pb-2 text-right font-medium">Rev/customer</th>
                  <th className="pb-2 text-right font-medium">Retention</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {data.cohorts.map((c) => (
                  <tr key={c.cohort} className="text-slate-300">
                    <td className="py-2 font-mono text-xs">{c.cohort}</td>
                    <td className="py-2 text-right">{c.customers}</td>
                    <td className="py-2 text-right">{c.paying}</td>
                    <td className="py-2 text-right">{money(c.revenue)}</td>
                    <td className="py-2 text-right">{money(c.revenue_per_customer)}</td>
                    <td className="py-2 text-right">
                      <span className="inline-flex items-center gap-2">
                        <span className="h-1.5 w-16 overflow-hidden rounded-full bg-white/10">
                          <span className="block h-full bg-emerald-400" style={{ width: `${c.retention_pct}%` }} />
                        </span>
                        {c.retention_pct}%
                      </span>
                    </td>
                  </tr>
                ))}
                {data.cohorts.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-slate-500">
                      No cohorts yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </>
  );
}
