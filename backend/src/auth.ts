import type { FastifyRequest } from 'fastify';
import type { DB } from './db.js';
import { forbidden, unauthorized } from './errors.js';
import { genKey, nowIso } from './ids.js';
import { getAppByPublicKey, type AppRow } from './repo/apps.js';
import { recordSdkPing } from './repo/diagnostics.js';
import { getDefaultProjectId } from './repo/projects.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the public-key guard: the app the pk_ key belongs to. */
    app?: AppRow;
    /** Set by both guards: the project (tenant) the request is scoped to. */
    projectId?: string;
  }
}

function bearerKey(req: FastifyRequest): string {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw unauthorized('Missing Authorization: Bearer <key> header.');
  }
  const key = header.slice('Bearer '.length).trim();
  if (!key) throw unauthorized('Missing API key.');
  return key;
}

/** Guard for /v1/* SDK endpoints: requires the pk_ key of an existing app. */
export function requirePublicKey(db: DB) {
  return async (req: FastifyRequest): Promise<void> => {
    const key = bearerKey(req);
    if (key.startsWith('sk_')) {
      const known = db.prepare('SELECT key FROM secret_keys WHERE key = ?').get(key);
      if (known) throw forbidden('Secret keys cannot be used on public endpoints; use the app public key.');
      throw unauthorized('Unknown API key.');
    }
    const app = getAppByPublicKey(db, key);
    if (!app) throw unauthorized('Unknown API key.');
    req.app = app;
    req.projectId = app.project_id;
    try {
      recordSdkPing(db, app.id, req);
    } catch {
      // diagnostics are best-effort; never fail a request because of them
    }
  };
}

/** Guard for /v1/admin/* endpoints: requires any known sk_ key. */
export function requireSecretKey(db: DB) {
  return async (req: FastifyRequest): Promise<void> => {
    const key = bearerKey(req);
    if (key.startsWith('pk_')) {
      const known = db.prepare('SELECT id FROM apps WHERE public_api_key = ?').get(key);
      if (known) throw forbidden('Public keys cannot be used on admin endpoints; use a secret key.');
      throw unauthorized('Unknown API key.');
    }
    const known = db.prepare('SELECT project_id FROM secret_keys WHERE key = ?').get(key) as
      | { project_id: string | null }
      | undefined;
    if (!known) throw unauthorized('Unknown API key.');
    req.projectId = known.project_id ?? getDefaultProjectId(db);
  };
}

/** Generates and stores the root sk_ key on first run; returns it on every boot. */
export function ensureRootSecretKey(db: DB): string {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'root_secret_key'").get() as
    | { value: string }
    | undefined;
  if (row) return row.value;
  const key = genKey('sk');
  const projectId = getDefaultProjectId(db);
  db.transaction(() => {
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('root_secret_key', key);
    db.prepare('INSERT INTO secret_keys (key, project_id, created_at) VALUES (?, ?, ?)').run(
      key,
      projectId,
      nowIso(),
    );
  })();
  return key;
}
