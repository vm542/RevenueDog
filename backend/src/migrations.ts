import type { DB } from './db.js';
import { genId, genKey, nowIso } from './ids.js';
import { hashApiKey, keyPrefix } from './keys.js';

/** The id of the auto-provisioned tenant, stored in `meta` so app code can resolve it. */
export const DEFAULT_PROJECT_META_KEY = 'default_project_id';

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
  /**
   * When false, the runner does NOT wrap `up` in a transaction — required for
   * migrations that toggle `PRAGMA foreign_keys` (a no-op inside a transaction),
   * e.g. SQLite table rebuilds. Such migrations must manage their own atomicity.
   */
  transactional?: boolean;
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
  {
    // Multi-tenancy: organizations -> projects -> apps, with every app-owned row
    // scoped by project_id. Existing data is adopted into one auto-provisioned
    // "Default" org/project, so single-tenant installs keep working unchanged.
    //
    // Non-transactional: rebuilding products/entitlements/offerings/aliases to
    // swap global UNIQUE/PRIMARY KEY constraints for per-project ones requires
    // PRAGMA foreign_keys=OFF, which can't be toggled inside a transaction.
    version: 4,
    transactional: false,
    up: (db) => {
      const now = nowIso();
      const orgId = genId('org');
      const projectId = genId('proj');

      db.pragma('foreign_keys = OFF');
      try {
        db.transaction(() => {
          db.exec(`
            CREATE TABLE IF NOT EXISTS organizations (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS projects (
              id TEXT PRIMARY KEY,
              org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
              name TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_projects_org ON projects(org_id);
          `);
          db.prepare('INSERT INTO organizations (id, name, created_at) VALUES (?, ?, ?)').run(
            orgId,
            'Default',
            now,
          );
          db.prepare('INSERT INTO projects (id, org_id, name, created_at) VALUES (?, ?, ?, ?)').run(
            projectId,
            orgId,
            'Default',
            now,
          );
          db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run(
            DEFAULT_PROJECT_META_KEY,
            projectId,
          );

          // --- Additive project_id columns, backfilled to the default project ---
          // subscriptions/non_subscriptions/receipts are denormalized with project_id
          // (reachable via subscriber, but a direct column keeps analytics filters simple).
          const scopedTables = [
            'secret_keys',
            'apps',
            'subscribers',
            'subscriptions',
            'non_subscriptions',
            'receipts',
            'experiments',
            'webhooks',
            'events',
          ];
          for (const table of scopedTables) {
            addColumn(db, table, 'project_id', 'TEXT');
            db.prepare(`UPDATE ${table} SET project_id = ? WHERE project_id IS NULL`).run(projectId);
          }

          // --- Table rebuilds to make uniqueness per-project (preserves ids/data) ---
          db.exec(`
            CREATE TABLE products_new (
              id TEXT PRIMARY KEY,
              project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
              store_identifier TEXT NOT NULL,
              type TEXT NOT NULL CHECK (type IN ('subscription','non_consumable','consumable')),
              store TEXT NOT NULL CHECK (store IN ('app_store','play_store')),
              display_name TEXT NOT NULL,
              duration TEXT,
              UNIQUE (project_id, store_identifier, store)
            );
            INSERT INTO products_new (id, project_id, store_identifier, type, store, display_name, duration)
              SELECT id, '${projectId}', store_identifier, type, store, display_name, duration FROM products;
            DROP TABLE products;
            ALTER TABLE products_new RENAME TO products;
            CREATE INDEX IF NOT EXISTS idx_products_project ON products(project_id);

            CREATE TABLE entitlements_new (
              id TEXT PRIMARY KEY,
              project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
              identifier TEXT NOT NULL,
              display_name TEXT NOT NULL,
              UNIQUE (project_id, identifier)
            );
            INSERT INTO entitlements_new (id, project_id, identifier, display_name)
              SELECT id, '${projectId}', identifier, display_name FROM entitlements;
            DROP TABLE entitlements;
            ALTER TABLE entitlements_new RENAME TO entitlements;
            CREATE INDEX IF NOT EXISTS idx_entitlements_project ON entitlements(project_id);

            CREATE TABLE offerings_new (
              id TEXT PRIMARY KEY,
              project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
              identifier TEXT NOT NULL,
              description TEXT NOT NULL DEFAULT '',
              metadata TEXT NOT NULL DEFAULT '{}',
              is_current INTEGER NOT NULL DEFAULT 0,
              UNIQUE (project_id, identifier)
            );
            INSERT INTO offerings_new (id, project_id, identifier, description, metadata, is_current)
              SELECT id, '${projectId}', identifier, description, metadata, is_current FROM offerings;
            DROP TABLE offerings;
            ALTER TABLE offerings_new RENAME TO offerings;
            CREATE INDEX IF NOT EXISTS idx_offerings_project ON offerings(project_id);

            CREATE TABLE aliases_new (
              project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
              app_user_id TEXT NOT NULL,
              subscriber_id TEXT NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
              PRIMARY KEY (project_id, app_user_id)
            );
            INSERT INTO aliases_new (project_id, app_user_id, subscriber_id)
              SELECT '${projectId}', app_user_id, subscriber_id FROM aliases;
            DROP TABLE aliases;
            ALTER TABLE aliases_new RENAME TO aliases;
            CREATE INDEX IF NOT EXISTS idx_aliases_subscriber ON aliases(subscriber_id);
          `);

          db.exec('CREATE INDEX IF NOT EXISTS idx_subscribers_project ON subscribers(project_id)');
          db.exec('CREATE INDEX IF NOT EXISTS idx_events_project ON events(project_id)');
        })();
        const violations = db.pragma('foreign_key_check');
        if (Array.isArray(violations) && violations.length > 0) {
          throw new Error(`Migration v4 left foreign key violations: ${JSON.stringify(violations)}`);
        }
      } finally {
        db.pragma('foreign_keys = ON');
      }
    },
  },
  {
    // Hosted accounts: dashboard users (per organization) and opaque login sessions.
    // Enables self-serve signup/login for the hosted version.
    version: 5,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          email TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);

        CREATE TABLE IF NOT EXISTS sessions (
          token TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL,
          expires_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      `);
    },
  },
  {
    // Security: stop storing secret keys in plaintext. Rebuild secret_keys to hold only
    // a SHA-256 hash + a short display prefix; the full key is shown once at creation.
    // Existing plaintext keys are hashed in place (no key changes, no re-issue needed).
    version: 6,
    up: (db) => {
      const existing = db.prepare('SELECT key, project_id, created_at FROM secret_keys').all() as {
        key: string;
        project_id: string | null;
        created_at: string;
      }[];
      db.exec(`
        ALTER TABLE secret_keys RENAME TO secret_keys_old;
        CREATE TABLE secret_keys (
          id TEXT PRIMARY KEY,
          key_hash TEXT NOT NULL UNIQUE,
          key_prefix TEXT NOT NULL,
          project_id TEXT,
          created_at TEXT NOT NULL,
          last_used_at TEXT
        );
      `);
      const insert = db.prepare(
        `INSERT INTO secret_keys (id, key_hash, key_prefix, project_id, created_at, last_used_at)
         VALUES (?, ?, ?, ?, ?, NULL)`,
      );
      for (const row of existing) {
        insert.run(genId('key'), hashApiKey(row.key), keyPrefix(row.key), row.project_id, row.created_at);
      }
      db.exec('DROP TABLE secret_keys_old');
      db.exec('CREATE INDEX IF NOT EXISTS idx_secret_keys_project ON secret_keys(project_id)');
    },
  },
  {
    // Security: audit log for sensitive actions (auth + API-key lifecycle).
    version: 7,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS audit_log (
          id TEXT PRIMARY KEY,
          project_id TEXT,
          actor TEXT NOT NULL,
          action TEXT NOT NULL,
          target TEXT,
          ip TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_audit_project ON audit_log(project_id);
        CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
      `);
    },
  },
];

/** Latest schema version the code expects. */
export const LATEST_SCHEMA_VERSION = MIGRATIONS.reduce((m, x) => Math.max(m, x.version), 0);

/** Runs every migration newer than the database's current user_version, in order. */
export function runMigrations(db: DB, fromVersion: number): void {
  for (const m of MIGRATIONS) {
    if (fromVersion < m.version) {
      if (m.transactional === false) m.up(db);
      else db.transaction(() => m.up(db))();
    }
  }
}
