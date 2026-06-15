import type { DB } from '../db.js';
import { genId, genKey, nowIso } from '../ids.js';

export interface AppRow {
  id: string;
  name: string;
  public_api_key: string;
  bundle_id: string | null;
  package_name: string | null;
  created_at: string;
}

export interface CreateAppInput {
  name: string;
  bundle_id?: string | null;
  package_name?: string | null;
}

export function createApp(db: DB, input: CreateAppInput): AppRow {
  const row: AppRow = {
    id: genId('app'),
    name: input.name,
    public_api_key: genKey('pk'),
    bundle_id: input.bundle_id ?? null,
    package_name: input.package_name ?? null,
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO apps (id, name, public_api_key, bundle_id, package_name, created_at)
     VALUES (@id, @name, @public_api_key, @bundle_id, @package_name, @created_at)`,
  ).run(row);
  return row;
}

export function listApps(db: DB): AppRow[] {
  return db.prepare('SELECT * FROM apps ORDER BY created_at ASC').all() as AppRow[];
}

export function getApp(db: DB, id: string): AppRow | undefined {
  return db.prepare('SELECT * FROM apps WHERE id = ?').get(id) as AppRow | undefined;
}

export function getAppByPublicKey(db: DB, key: string): AppRow | undefined {
  return db.prepare('SELECT * FROM apps WHERE public_api_key = ?').get(key) as AppRow | undefined;
}

export function deleteApp(db: DB, id: string): boolean {
  return db.prepare('DELETE FROM apps WHERE id = ?').run(id).changes > 0;
}
