import { useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useApi, type Overview as OverviewData } from '../api.ts';
import { Card, PageHeader, Spinner } from '../components/ui.tsx';
import { useResource } from '../lib/useResource.ts';
import { compactNumber, dateTime, money, shortDate } from '../lib/format.ts';

const RANGES = [7, 28, 90];
const STATUS_COLORS: Record<string, string> = {
  active: '#34d399',
  trial: '#818cf8',
  expired: '#64748b',
  billing_issue: '#f87171',
};

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-white">{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </Card>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-5">
      <h3 className="mb-4 text-sm font-medium text-slate-300">{title}</h3>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          {children as React.ReactElement}
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

const tooltipStyle = {
  background: '#11162a',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 12,
  color: '#e2e8f0',
  fontSize: 12,
};

export function Overview() {
  const { api } = useApi();
  const [range, setRange] = useState(28);
  const { data, loading, error } = useResource<OverviewData>(() => api.get(`/v1/admin/overview?range=${range}`), [range]);

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="Subscription revenue and growth at a glance"
        actions={
          <div className="flex rounded-lg border border-white/10 bg-ink-900 p-1">
            {RANGES.map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`rounded-md px-3 py-1 text-sm transition ${
                  range === r ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {r}d
              </button>
            ))}
          </div>
        }
      />

      {error && <p className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</p>}
      {loading && !data ? (
        <Spinner />
      ) : data ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Kpi label="MRR" value={money(data.kpis.mrr)} sub="Monthly recurring revenue" />
            <Kpi label={`Revenue (${range}d)`} value={money(data.kpis.revenue)} sub={`${data.kpis.new_customers} new customers`} />
            <Kpi label="Active subscriptions" value={compactNumber(data.kpis.active_subscriptions)} sub={`${data.kpis.active_trials} in trial`} />
            <Kpi label="Total customers" value={compactNumber(data.kpis.total_subscribers)} sub={`${data.kpis.active_subscribers} with active access`} />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard title={`Revenue (last ${range} days)`}>
              <AreaChart data={data.charts.revenue} margin={{ left: -20, right: 8, top: 4 }}>
                <defs>
                  <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tickFormatter={shortDate} stroke="#475569" fontSize={11} tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis stroke="#475569" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `$${compactNumber(v)}`} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => money(v)} labelFormatter={shortDate} />
                <Area type="monotone" dataKey="value" stroke="#818cf8" strokeWidth={2} fill="url(#rev)" />
              </AreaChart>
            </ChartCard>

            <ChartCard title="Active subscriptions over time">
              <AreaChart data={data.charts.active_subscriptions} margin={{ left: -20, right: 8, top: 4 }}>
                <defs>
                  <linearGradient id="act" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#34d399" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tickFormatter={shortDate} stroke="#475569" fontSize={11} tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis stroke="#475569" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} labelFormatter={shortDate} />
                <Area type="monotone" dataKey="value" stroke="#34d399" strokeWidth={2} fill="url(#act)" />
              </AreaChart>
            </ChartCard>

            <ChartCard title="New customers">
              <BarChart data={data.charts.new_customers} margin={{ left: -20, right: 8, top: 4 }}>
                <XAxis dataKey="date" tickFormatter={shortDate} stroke="#475569" fontSize={11} tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis stroke="#475569" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(255,255,255,0.04)' }} labelFormatter={shortDate} />
                <Bar dataKey="value" fill="#6366f1" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ChartCard>

            <ChartCard title="Subscription status">
              <PieChart>
                <Pie
                  data={data.subscription_status}
                  dataKey="count"
                  nameKey="status"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                >
                  {data.subscription_status.map((s) => (
                    <Cell key={s.status} fill={STATUS_COLORS[s.status] ?? '#64748b'} />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
              </PieChart>
            </ChartCard>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
            <Card className="p-5 lg:col-span-2">
              <h3 className="mb-4 text-sm font-medium text-slate-300">Revenue by product</h3>
              <div className="space-y-3">
                {data.revenue_by_product.length === 0 && <p className="text-sm text-slate-500">No revenue yet.</p>}
                {data.revenue_by_product.map((p) => {
                  const max = data.revenue_by_product[0]?.revenue || 1;
                  return (
                    <div key={p.product}>
                      <div className="mb-1 flex justify-between text-sm">
                        <span className="text-slate-300">{p.product}</span>
                        <span className="text-slate-400">{money(p.revenue)}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-white/5">
                        <div className="h-full rounded-full bg-brand-500" style={{ width: `${(p.revenue / max) * 100}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card className="p-5 lg:col-span-3">
              <h3 className="mb-4 text-sm font-medium text-slate-300">Recent transactions</h3>
              <div className="overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="pb-2 font-medium">Customer</th>
                      <th className="pb-2 font-medium">Product</th>
                      <th className="pb-2 font-medium">Store</th>
                      <th className="pb-2 text-right font-medium">Price</th>
                      <th className="pb-2 text-right font-medium">When</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {data.recent_transactions.map((t) => (
                      <tr key={t.id} className="text-slate-300">
                        <td className="py-2 font-mono text-xs text-slate-400">{t.app_user_id}</td>
                        <td className="py-2">{t.product}</td>
                        <td className="py-2 text-slate-400">{t.store === 'app_store' ? '🍎 App Store' : '🤖 Play'}</td>
                        <td className="py-2 text-right">{money(t.price, t.currency ?? 'USD')}</td>
                        <td className="py-2 text-right text-slate-500">{dateTime(t.date)}</td>
                      </tr>
                    ))}
                    {data.recent_transactions.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-6 text-center text-slate-500">
                          No transactions yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      ) : null}
    </>
  );
}
