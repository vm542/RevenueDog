import type { Config } from '../config.js';
import type { DB } from '../db.js';
import { storeProblem } from '../errors.js';
import { createProduct, type ProductStore } from '../repo/products.js';

export interface ImportResult {
  imported: number;
  skipped: number;
  failed: { identifier: string; error: string }[];
}

/**
 * Imports a product catalog directly from the store's developer API.
 *
 * App Store Connect (App Store Connect API) and Google Play (Android Publisher API)
 * both require credentials. When those aren't configured this returns a clear
 * `store_problem` so the dashboard can prompt the user — meanwhile the CSV / bulk-JSON
 * import (`POST /v1/admin/products/import`) works without any store credentials.
 */
export async function importStoreProducts(
  db: DB,
  projectId: string,
  store: ProductStore,
  _config: Config,
): Promise<ImportResult> {
  void projectId; // used once the real catalog fetchers below are implemented
  if (store === 'app_store') {
    if (!process.env.APPLE_ISSUER_ID || !process.env.APPLE_KEY_ID || !process.env.APPLE_PRIVATE_KEY) {
      throw storeProblem(
        'App Store Connect import requires APPLE_ISSUER_ID, APPLE_KEY_ID and APPLE_PRIVATE_KEY. ' +
          'Use the CSV/bulk import in the meantime.',
      );
    }
    return fetchAppStoreCatalog(db);
  }
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON || !process.env.GOOGLE_PACKAGE_NAME) {
    throw storeProblem(
      'Google Play import requires GOOGLE_SERVICE_ACCOUNT_JSON and GOOGLE_PACKAGE_NAME. ' +
        'Use the CSV/bulk import in the meantime.',
    );
  }
  return fetchPlayCatalog(db);
}

// Scaffolds: the credential-gated paths above guarantee these only run when configured.
// Contributions implementing the real API calls are very welcome (see CONTRIBUTING.md).
async function fetchAppStoreCatalog(_db: DB): Promise<ImportResult> {
  throw storeProblem('App Store Connect catalog fetch is not yet implemented.');
}

async function fetchPlayCatalog(_db: DB): Promise<ImportResult> {
  throw storeProblem('Google Play catalog fetch is not yet implemented.');
}

/** Used by the bulk importer to surface a consistent shape (kept for symmetry/tests). */
export function bulkImport(
  db: DB,
  projectId: string,
  products: { store_identifier: string; type: 'subscription' | 'non_consumable' | 'consumable'; store: ProductStore; display_name: string; duration?: string | null }[],
): ImportResult {
  let imported = 0;
  let skipped = 0;
  const failed: { identifier: string; error: string }[] = [];
  for (const p of products) {
    try {
      createProduct(db, projectId, p);
      imported++;
    } catch (err) {
      if (err instanceof Error && /already exists/.test(err.message)) skipped++;
      else failed.push({ identifier: p.store_identifier, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { imported, skipped, failed };
}
