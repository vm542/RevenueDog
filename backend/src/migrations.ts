import type { DB } from './db.js';
import { genKey } from './ids.js';

/**
 * Ordered, forward-only schema migrations. Each runs exactly once, tracked by the
 * SQLite `user_version` pragma. Unlike a bare `CREATE TABLE IF NOT EXISTS` pass, these
 * can `ALTER` existing tables, so a self-hoster upgrading an existing database actually
 * gets the new columns/indexes (the previous schema-version approach silently did not).
 *
 * Rules: never edit a shipped migration; only append. Keep each `up` idempotent where
 * cheap, so a partially-applied migration can be re-run safely.
 */
export interface Migration {
  version: number;
  up: (db: DB) => void;
}

/** ALTER TABLE ADD COLUMN that tolerates the column already existing. */
function addColumn(db: DB, table: string, column: string, type: string): void {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  } catch (err) {
    if (!/duplicate column name/i.test(String(err))) throw err;
  }
}

export const MIGRATIONS: Migration[] = [
  {
    // Per-platform public API keys, so the official RevenueCat SDK (which is configured
    // with an `appl_`/`goog_` key) can authenticate against RevenueDog unchanged.
    version: 3,
    up: (db) => {
      addColumn(db, 'apps', 'apple_api_key', 'TEXT');
      addColumn(db, 'apps', 'google_api_key', 'TEXT');
      const apps = db
        .prepare('SELECT id, apple_api_key, google_api_key FROM apps')
        .all() as { id: string; apple_api_key: string | null; google_api_key: string | null }[];
      for (const app of apps) {
        if (!app.apple_api_key) {
          db.prepare('UPDATE apps SET apple_api_key = ? WHERE id = ?').run(genKey('appl'), app.id);
        }
        if (!app.google_api_key) {
          db.prepare('UPDATE apps SET google_api_key = ? WHERE id = ?').run(genKey('goog'), app.id);
        }
      }
      db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_apps_apple_key ON apps(apple_api_key)');
      db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_apps_google_key ON apps(google_api_key)');
    },
  },
];

/** Latest schema version the code expects. */
export const LATEST_SCHEMA_VERSION = MIGRATIONS.reduce((m, x) => Math.max(m, x.version), 0);

/** Runs every migration newer than the database's current user_version, in order. */
export function runMigrations(db: DB, fromVersion: number): void {
  for (const m of MIGRATIONS) {
    if (fromVersion < m.version) {
      db.transaction(() => m.up(db))();
    }
  }
}
