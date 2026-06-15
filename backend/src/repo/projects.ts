import type { DB } from '../db.js';
import { notFound } from '../errors.js';
import { genId, nowIso } from '../ids.js';
import { DEFAULT_PROJECT_META_KEY } from '../migrations.js';

export interface OrganizationRow {
  id: string;
  name: string;
  created_at: string;
}

export interface ProjectRow {
  id: string;
  org_id: string;
  name: string;
  created_at: string;
}

/** The auto-provisioned project that adopts pre-multi-tenancy data. */
export function getDefaultProjectId(db: DB): string {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(DEFAULT_PROJECT_META_KEY) as
    | { value: string }
    | undefined;
  if (!row) throw new Error('Default project missing — database not migrated.');
  return row.value;
}

export function createOrganization(db: DB, name: string): OrganizationRow {
  const row: OrganizationRow = { id: genId('org'), name, created_at: nowIso() };
  db.prepare('INSERT INTO organizations (id, name, created_at) VALUES (@id, @name, @created_at)').run(row);
  return row;
}

export function createProject(db: DB, orgId: string, name: string): ProjectRow {
  const org = db.prepare('SELECT id FROM organizations WHERE id = ?').get(orgId);
  if (!org) throw notFound('No organization with that id.');
  const row: ProjectRow = { id: genId('proj'), org_id: orgId, name, created_at: nowIso() };
  db.prepare(
    'INSERT INTO projects (id, org_id, name, created_at) VALUES (@id, @org_id, @name, @created_at)',
  ).run(row);
  return row;
}

export function listProjects(db: DB): ProjectRow[] {
  return db.prepare('SELECT * FROM projects ORDER BY created_at ASC').all() as ProjectRow[];
}

export function getProject(db: DB, id: string): ProjectRow | undefined {
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
}
