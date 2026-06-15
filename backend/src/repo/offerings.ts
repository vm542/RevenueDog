import type { DB } from '../db.js';
import { conflict, notFound } from '../errors.js';
import { genId } from '../ids.js';

export interface OfferingRow {
  id: string;
  identifier: string;
  description: string;
  metadata: string; // JSON string in DB
  is_current: number;
}

export interface PackageInput {
  identifier: string;
  product_ids: string[];
}

export interface PackageView {
  id: string;
  identifier: string;
  position: number;
  product_ids: string[];
}

export interface Offering {
  id: string;
  identifier: string;
  description: string;
  metadata: Record<string, unknown>;
  is_current: boolean;
  packages: PackageView[];
}

export interface CreateOfferingInput {
  identifier: string;
  description?: string;
  metadata?: Record<string, unknown>;
  is_current?: boolean;
  packages?: PackageInput[];
}

function packagesFor(db: DB, offeringId: string): PackageView[] {
  const pkgs = db
    .prepare('SELECT * FROM packages WHERE offering_id = ? ORDER BY position ASC, identifier ASC')
    .all(offeringId) as { id: string; identifier: string; position: number }[];
  return pkgs.map((p) => ({
    id: p.id,
    identifier: p.identifier,
    position: p.position,
    product_ids: (
      db.prepare('SELECT product_id FROM package_products WHERE package_id = ?').all(p.id) as {
        product_id: string;
      }[]
    ).map((r) => r.product_id),
  }));
}

function hydrate(db: DB, row: OfferingRow): Offering {
  return {
    id: row.id,
    identifier: row.identifier,
    description: row.description,
    metadata: JSON.parse(row.metadata || '{}'),
    is_current: !!row.is_current,
    packages: packagesFor(db, row.id),
  };
}

function setPackages(db: DB, offeringId: string, packages: PackageInput[]): void {
  db.prepare('DELETE FROM packages WHERE offering_id = ?').run(offeringId);
  packages.forEach((pkg, index) => {
    const pkgId = genId('pkg');
    db.prepare(
      'INSERT INTO packages (id, offering_id, identifier, position) VALUES (?, ?, ?, ?)',
    ).run(pkgId, offeringId, pkg.identifier, index);
    for (const pid of pkg.product_ids) {
      const exists = db.prepare('SELECT id FROM products WHERE id = ?').get(pid);
      if (!exists) throw notFound(`No product with id "${pid}".`);
      db.prepare('INSERT INTO package_products (package_id, product_id) VALUES (?, ?)').run(pkgId, pid);
    }
  });
}

function clearCurrentExcept(db: DB, keepId: string): void {
  db.prepare('UPDATE offerings SET is_current = 0 WHERE id != ?').run(keepId);
}

export function createOffering(db: DB, input: CreateOfferingInput): Offering {
  const id = genId('off');
  return db.transaction(() => {
    try {
      db.prepare(
        `INSERT INTO offerings (id, identifier, description, metadata, is_current)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(id, input.identifier, input.description ?? '', JSON.stringify(input.metadata ?? {}), input.is_current ? 1 : 0);
    } catch (err) {
      if (String(err).includes('UNIQUE')) {
        throw conflict(`An offering with identifier "${input.identifier}" already exists.`);
      }
      throw err;
    }
    setPackages(db, id, input.packages ?? []);
    if (input.is_current) clearCurrentExcept(db, id);
    return hydrate(db, db.prepare('SELECT * FROM offerings WHERE id = ?').get(id) as OfferingRow);
  })();
}

export function listOfferings(db: DB): Offering[] {
  const rows = db.prepare('SELECT * FROM offerings ORDER BY identifier ASC').all() as OfferingRow[];
  return rows.map((r) => hydrate(db, r));
}

export function getOffering(db: DB, id: string): Offering | undefined {
  const row = db.prepare('SELECT * FROM offerings WHERE id = ?').get(id) as OfferingRow | undefined;
  return row ? hydrate(db, row) : undefined;
}

export function getCurrentOffering(db: DB): Offering | undefined {
  const row = db.prepare('SELECT * FROM offerings WHERE is_current = 1 LIMIT 1').get() as
    | OfferingRow
    | undefined;
  return row ? hydrate(db, row) : undefined;
}

export function updateOffering(db: DB, id: string, patch: Partial<CreateOfferingInput>): Offering {
  const existing = db.prepare('SELECT * FROM offerings WHERE id = ?').get(id) as OfferingRow | undefined;
  if (!existing) throw notFound('No offering with that id.');
  return db.transaction(() => {
    const next = {
      identifier: patch.identifier ?? existing.identifier,
      description: patch.description ?? existing.description,
      metadata: patch.metadata !== undefined ? JSON.stringify(patch.metadata) : existing.metadata,
      is_current: patch.is_current !== undefined ? (patch.is_current ? 1 : 0) : existing.is_current,
    };
    db.prepare(
      'UPDATE offerings SET identifier=?, description=?, metadata=?, is_current=? WHERE id=?',
    ).run(next.identifier, next.description, next.metadata, next.is_current, id);
    if (patch.packages) setPackages(db, id, patch.packages);
    if (next.is_current) clearCurrentExcept(db, id);
    return hydrate(db, db.prepare('SELECT * FROM offerings WHERE id = ?').get(id) as OfferingRow);
  })();
}

export function deleteOffering(db: DB, id: string): boolean {
  return db.prepare('DELETE FROM offerings WHERE id = ?').run(id).changes > 0;
}
