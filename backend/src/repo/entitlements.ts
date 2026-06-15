import type { DB } from '../db.js';
import { conflict, notFound } from '../errors.js';
import { genId } from '../ids.js';

export interface EntitlementRow {
  id: string;
  identifier: string;
  display_name: string;
}

export interface Entitlement extends EntitlementRow {
  product_ids: string[];
}

export interface CreateEntitlementInput {
  identifier: string;
  display_name: string;
  product_ids?: string[];
}

function productIdsFor(db: DB, entitlementId: string): string[] {
  return (
    db
      .prepare('SELECT product_id FROM entitlement_products WHERE entitlement_id = ? ORDER BY product_id')
      .all(entitlementId) as { product_id: string }[]
  ).map((r) => r.product_id);
}

function setProducts(db: DB, projectId: string, entitlementId: string, productIds: string[]): void {
  db.prepare('DELETE FROM entitlement_products WHERE entitlement_id = ?').run(entitlementId);
  const insert = db.prepare(
    'INSERT INTO entitlement_products (entitlement_id, product_id) VALUES (?, ?)',
  );
  for (const pid of productIds) {
    const exists = db.prepare('SELECT id FROM products WHERE id = ? AND project_id = ?').get(pid, projectId);
    if (!exists) throw notFound(`No product with id "${pid}".`);
    insert.run(entitlementId, pid);
  }
}

export function createEntitlement(db: DB, projectId: string, input: CreateEntitlementInput): Entitlement {
  const row: EntitlementRow = {
    id: genId('ent'),
    identifier: input.identifier,
    display_name: input.display_name,
  };
  return db.transaction(() => {
    try {
      db.prepare(
        'INSERT INTO entitlements (id, project_id, identifier, display_name) VALUES (?, ?, ?, ?)',
      ).run(row.id, projectId, row.identifier, row.display_name);
    } catch (err) {
      if (String(err).includes('UNIQUE')) {
        throw conflict(`An entitlement with identifier "${input.identifier}" already exists.`);
      }
      throw err;
    }
    setProducts(db, projectId, row.id, input.product_ids ?? []);
    return { ...row, product_ids: productIdsFor(db, row.id) };
  })();
}

export function listEntitlements(db: DB, projectId: string): Entitlement[] {
  const rows = db
    .prepare('SELECT * FROM entitlements WHERE project_id = ? ORDER BY identifier ASC')
    .all(projectId) as EntitlementRow[];
  return rows.map((r) => ({ ...r, product_ids: productIdsFor(db, r.id) }));
}

export function getEntitlement(db: DB, projectId: string, id: string): Entitlement | undefined {
  const row = db.prepare('SELECT * FROM entitlements WHERE id = ? AND project_id = ?').get(id, projectId) as
    | EntitlementRow
    | undefined;
  if (!row) return undefined;
  return { ...row, product_ids: productIdsFor(db, row.id) };
}

export function updateEntitlement(
  db: DB,
  projectId: string,
  id: string,
  patch: { identifier?: string; display_name?: string; product_ids?: string[] },
): Entitlement {
  const existing = db.prepare('SELECT * FROM entitlements WHERE id = ? AND project_id = ?').get(id, projectId) as
    | EntitlementRow
    | undefined;
  if (!existing) throw notFound('No entitlement with that id.');
  return db.transaction(() => {
    const next: EntitlementRow = {
      ...existing,
      identifier: patch.identifier ?? existing.identifier,
      display_name: patch.display_name ?? existing.display_name,
    };
    db.prepare('UPDATE entitlements SET identifier=@identifier, display_name=@display_name WHERE id=@id').run(next);
    if (patch.product_ids) setProducts(db, projectId, id, patch.product_ids);
    return { ...next, product_ids: productIdsFor(db, id) };
  })();
}

export function deleteEntitlement(db: DB, projectId: string, id: string): boolean {
  return db.prepare('DELETE FROM entitlements WHERE id = ? AND project_id = ?').run(id, projectId).changes > 0;
}

/** Entitlement identifiers granted by owning a product with the given store identifier, within a project. */
export function entitlementsForStoreIdentifier(
  db: DB,
  projectId: string,
  storeIdentifier: string,
): EntitlementRow[] {
  return db
    .prepare(
      `SELECT DISTINCT e.* FROM entitlements e
       JOIN entitlement_products ep ON ep.entitlement_id = e.id
       JOIN products p ON p.id = ep.product_id
       WHERE e.project_id = ? AND p.store_identifier = ?`,
    )
    .all(projectId, storeIdentifier) as EntitlementRow[];
}
