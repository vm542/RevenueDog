import { useApi, type AuditEntry } from '../api.ts';
import { useResource } from '../lib/useResource.ts';
import { Badge, Card, EmptyState, PageHeader, Spinner } from '../components/ui.tsx';
import { dateTime } from '../lib/format.ts';

function actionTone(action: string): 'green' | 'amber' | 'red' | 'slate' | 'indigo' {
  if (action.startsWith('auth.')) return 'indigo';
  if (action === 'key.create') return 'green';
  if (action === 'key.delete') return 'red';
  return 'slate';
}

export function Audit() {
  const { api } = useApi();
  const { data, error, loading } = useResource<{ items: AuditEntry[] }>(() => api.get('/v1/admin/audit'));

  if (loading) return <Spinner />;
  if (error) return <EmptyState title="Could not load audit log" hint={error} />;
  const items = data?.items ?? [];

  return (
    <div>
      <PageHeader title="Audit Log" subtitle="Security-relevant actions: sign-ins, sign-ups, and API-key changes." />
      {items.length === 0 ? (
        <EmptyState title="No audit entries yet" hint="Account and key activity will appear here." />
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">When</th>
                <th className="px-5 py-3 font-medium">Action</th>
                <th className="px-5 py-3 font-medium">Actor</th>
                <th className="px-5 py-3 font-medium">Target</th>
                <th className="px-5 py-3 font-medium">IP</th>
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id} className="border-b border-white/5 last:border-0">
                  <td className="px-5 py-3 text-slate-400">{dateTime(e.created_at)}</td>
                  <td className="px-5 py-3">
                    <Badge tone={actionTone(e.action)}>{e.action}</Badge>
                  </td>
                  <td className="px-5 py-3 text-slate-200">{e.actor}</td>
                  <td className="px-5 py-3 font-mono text-xs text-slate-500">{e.target ?? '—'}</td>
                  <td className="px-5 py-3 font-mono text-xs text-slate-500">{e.ip ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
