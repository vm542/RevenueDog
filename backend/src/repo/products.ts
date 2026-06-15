import type { DB } from '../db.js';
import { conflict, notFound } from '../errors.js';
import { genId } from '../ids.js';

export type ProductType = 'subscription' | 'non_consumable' | 'consumable';
export type ProductStore = 'app_store' | 'play_store';

export interface ProductRow {
  id: string;
  project_id: string;
  store_identifier: string;
  type: ProductType;
  store: ProductStore;
  display_name: string;
  duration: string | null;
}

export interface CreateProductInput {
  store_identifier: string;
  type: ProductType;
  store: ProductStore;
  display_name: string;
  duration?: string | null;
}

export function createProduct(db: DB, projectId: string, input: CreateProductInput): ProductRow {
  const row: ProductRow = {
    id: genId('prod'),
    project_id: projectId,
    store_identifier: input.store_identifier,
    type: input.type,
    store: input.store,
    display_name: input.display_name,
    duration: input.duration ?? null,
  };
  try {
    db.prepare(
      `INSERT INTO products (id, project_id, store_identifier, type, store, display_name, duration)
       VALUES (@id, @project_id, @store_identifier, @type, @store, @display_name, @duration)`,
    ).run(row);
  } catch (err) {
    if (String(err).includes('UNIQUE')) {
      throw conflict(`A product with store_identifier "${input.store_identifier}" already exists for ${input.store}.`);
    }
    throw err;
  }
  return row;
}

export function listProducts(db: DB, projectId: string): ProductRow[] {
  return db
    .prepare('SELECT * FROM products WHERE project_id = ? ORDER BY display_name ASC')
    .all(projectId) as ProductRow[];
}

export function getProduct(db: DB, projectId: string, id: string): ProductRow | undefined {
  return db.prepare('SELECT * FROM products WHERE id = ? AND project_id = ?').get(id, projectId) as
    | ProductRow
    | undefined;
}

export function getProductByStoreId(
  db: DB,
  projectId: string,
  storeIdentifier: string,
  store: ProductStore,
): ProductRow | undefined {
  return db
    .prepare('SELECT * FROM products WHERE project_id = ? AND store_identifier = ? AND store = ?')
    .get(projectId, storeIdentifier, store) as ProductRow | undefined;
}

export function getProductByStoreIdAny(
  db: DB,
  projectId: string,
  storeIdentifier: string,
): ProductRow | undefined {
  return db
    .prepare('SELECT * FROM products WHERE project_id = ? AND store_identifier = ? LIMIT 1')
    .get(projectId, storeIdentifier) as ProductRow | undefined;
}

export function updateProduct(
  db: DB,
  projectId: string,
  id: string,
  patch: Partial<CreateProductInput>,
): ProductRow {
  const existing = getProduct(db, projectId, id);
  if (!existing) throw notFound('No product with that id.');
  const next: ProductRow = {
    ...existing,
    store_identifier: patch.store_identifier ?? existing.store_identifier,
    type: patch.type ?? existing.type,
    store: patch.store ?? existing.store,
    display_name: patch.display_name ?? existing.display_name,
    duration: patch.duration !== undefined ? patch.duration : existing.duration,
  };
  db.prepare(
    `UPDATE products SET store_identifier=@store_identifier, type=@type, store=@store,
       display_name=@display_name, duration=@duration WHERE id=@id AND project_id=@project_id`,
  ).run(next);
  return next;
}

export function deleteProduct(db: DB, projectId: string, id: string): boolean {
  return db.prepare('DELETE FROM products WHERE id = ? AND project_id = ?').run(id, projectId).changes > 0;
}
