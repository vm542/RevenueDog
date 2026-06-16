import { useState } from 'react';
import { useApi, type ApiKeyRow, type Me, type ProjectSummary } from '../api.ts';
import { useResource } from '../lib/useResource.ts';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Spinner } from '../components/ui.tsx';
import { dateTime, relativeTime } from '../lib/format.ts';

export function Account() {
  const { conn, api, setProject } = useApi();

  if (conn.mode !== 'session') {
    return (
      <div>
        <PageHeader title="Account" />
        <EmptyState
          title="Accounts are a hosted feature"
          hint="You're connected with a self-host secret key. Sign in with an email account to manage projects and keys here."
        />
      </div>
    );
  }

  return <SessionAccount api={api} activeProjectId={conn.projectId!} email={conn.email} setProject={setProject!} />;
}

function SessionAccount({
  api,
  activeProjectId,
  email,
  setProject,
}: {
  api: ReturnType<typeof useApi>['api'];
  activeProjectId: string;
  email?: string;
  setProject: (id: string) => void;
}) {
  const me = useResource<Me>(() => api.get('/v1/auth/me'));
  const keys = useResource<{ items: ApiKeyRow[] }>(() => api.get(`/v1/projects/${activeProjectId}/keys`), [
    activeProjectId,
  ]);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [creatingProject, setCreatingProject] = useState(false);
  const [projectName, setProjectName] = useState('');

  async function createProject() {
    const res = await api.post<{ id: string; secret_key: string }>('/v1/projects', { name: projectName });
    setCreatingProject(false);
    setProjectName('');
    setNewSecret(res.secret_key);
    setProject(res.id);
    me.reload();
  }

  async function createKey() {
    const res = await api.post<{ secret_key: string }>(`/v1/projects/${activeProjectId}/keys`);
    setNewSecret(res.secret_key);
    keys.reload();
  }

  async function deleteKey(id: string) {
    await api.delete(`/v1/projects/${activeProjectId}/keys/${id}`);
    keys.reload();
  }

  return (
    <div>
      <PageHeader
        title="Account"
        subtitle={email ? `Signed in as ${email}` : undefined}
        actions={<Button onClick={() => setCreatingProject(true)}>+ New project</Button>}
      />

      {/* Projects */}
      <Card className="mb-6 overflow-hidden">
        <div className="border-b border-white/5 px-5 py-3 text-xs font-medium uppercase tracking-wide text-slate-500">
          Projects
        </div>
        {me.loading ? (
          <Spinner />
        ) : (
          (me.data?.projects ?? []).map((p: ProjectSummary) => (
            <div key={p.id} className="flex items-center justify-between border-b border-white/5 px-5 py-3 last:border-0">
              <div>
                <span className="text-slate-100">{p.name}</span>
                {p.id === activeProjectId && (
                  <span className="ml-2">
                    <Badge tone="green">active</Badge>
                  </span>
                )}
                <p className="font-mono text-xs text-slate-600">{p.id}</p>
              </div>
              {p.id !== activeProjectId && (
                <Button variant="ghost" onClick={() => setProject(p.id)}>
                  Switch to
                </Button>
              )}
            </div>
          ))
        )}
      </Card>

      {/* API keys for the active project */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/5 px-5 py-3">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
            API keys — active project
          </span>
          <Button variant="ghost" onClick={createKey}>
            + Create secret key
          </Button>
        </div>
        {keys.loading ? (
          <Spinner />
        ) : (keys.data?.items ?? []).length === 0 ? (
          <EmptyState title="No keys yet" hint="Create a secret key to use the admin API or this dashboard." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">Key</th>
                <th className="px-5 py-3 font-medium">Created</th>
                <th className="px-5 py-3 font-medium">Last used</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {keys.data!.items.map((k) => (
                <tr key={k.id} className="border-b border-white/5 last:border-0">
                  <td className="px-5 py-3 font-mono text-slate-300">{k.key_prefix}…</td>
                  <td className="px-5 py-3 text-slate-400">{dateTime(k.created_at)}</td>
                  <td className="px-5 py-3 text-slate-400">{relativeTime(k.last_used_at)}</td>
                  <td className="px-5 py-3 text-right">
                    <Button variant="danger" onClick={() => deleteKey(k.id)}>
                      Revoke
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {newSecret && (
        <Modal title="Copy your secret key now" onClose={() => setNewSecret(null)}>
          <p className="mb-3 text-sm text-slate-400">
            This is the only time the full key is shown. Store it securely.
          </p>
          <code className="block break-all rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-sm text-emerald-300">
            {newSecret}
          </code>
          <div className="mt-4 flex justify-end">
            <Button onClick={() => navigator.clipboard?.writeText(newSecret)}>Copy</Button>
          </div>
        </Modal>
      )}

      {creatingProject && (
        <Modal title="New project" onClose={() => setCreatingProject(false)}>
          <Field label="Project name">
            <Input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="My App" />
          </Field>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCreatingProject(false)}>
              Cancel
            </Button>
            <Button onClick={createProject} disabled={!projectName}>
              Create
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
