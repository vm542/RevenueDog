import type { DB } from '../db.js';
import { genId, genKey, nowIso } from '../ids.js';

export interface AppRow {
  id: string;
  project_id: string;
  name: string;
  public_api_key: string;
  /** RevenueCat-style iOS key (appl_…); the RC SDK authenticates with this on iOS. */
  apple_api_key: string;
  /** RevenueCat-style Android key (goog_…); the RC SDK authenticates with this on Android. */
  google_api_key: string;
  bundle_id: string | null;
  package_name: string | null;
  created_at: string;
}

export interface CreateAppInput {
  name: string;
  bundle_id?: string | null;
  package_name?: string | null;
}

export function createApp(db: DB, projectId: string, input: CreateAppInput): AppRow {
  const row: AppRow = {
    id: genId('app'),
    project_id: projectId,
    name: input.name,
    public_api_key: genKey('pk'),
    apple_api_key: genKey('appl'),
    google_api_key: genKey('goog'),
    bundle_id: input.bundle_id ?? null,
    package_name: input.package_name ?? null,
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO apps (id, project_id, name, public_api_key, apple_api_key, google_api_key, bundle_id, package_name, created_at)
     VALUES (@id, @project_id, @name, @public_api_key, @apple_api_key, @google_api_key, @bundle_id, @package_name, @created_at)`,
  ).run(row);
  return row;
}

export function listApps(db: DB, projectId: string): AppRow[] {
  return db
    .prepare('SELECT * FROM apps WHERE project_id = ? ORDER BY created_at ASC')
    .all(projectId) as AppRow[];
}

export function getApp(db: DB, projectId: string, id: string): AppRow | undefined {
  return db.prepare('SELECT * FROM apps WHERE id = ? AND project_id = ?').get(id, projectId) as
    | AppRow
    | undefined;
}

/** Resolves an app by any of its public keys: generic pk_, or platform appl_/goog_. */
export function getAppByPublicKey(db: DB, key: string): AppRow | undefined {
  return db
    .prepare(
      'SELECT * FROM apps WHERE public_api_key = ? OR apple_api_key = ? OR google_api_key = ?',
    )
    .get(key, key, key) as AppRow | undefined;
}

export function deleteApp(db: DB, projectId: string, id: string): boolean {
  return db.prepare('DELETE FROM apps WHERE id = ? AND project_id = ?').run(id, projectId).changes > 0;
}

/** Resolves the app (and thus the tenant) a store server notification belongs to. */
export function getAppByBundleId(db: DB, bundleId: string): AppRow | undefined {
  return db.prepare('SELECT * FROM apps WHERE bundle_id = ? LIMIT 1').get(bundleId) as AppRow | undefined;
}

export function getAppByPackageName(db: DB, packageName: string): AppRow | undefined {
  return db.prepare('SELECT * FROM apps WHERE package_name = ? LIMIT 1').get(packageName) as AppRow | undefined;
}
