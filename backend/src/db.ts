import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { LATEST_SCHEMA_VERSION, runMigrations } from './migrations.js';

export type DB = Database.Database;

/** Version at which the base SCHEMA below is complete; later changes live in migrations.ts. */
const BASE_SCHEMA_VERSION = 2;

/** The v2 base schema. Exported so migration tests can construct a realistic pre-upgrade DB. */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS secret_keys (
  key TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS apps (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  public_api_key TEXT NOT NULL UNIQUE,
  bundle_id TEXT,
  package_name TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  store_identifier TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('subscription','non_consumable','consumable')),
  store TEXT NOT NULL CHECK (store IN ('app_store','play_store')),
  display_name TEXT NOT NULL,
  duration TEXT,
  UNIQUE (store_identifier, store)
);

CREATE TABLE IF NOT EXISTS entitlements (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entitlement_products (
  entitlement_id TEXT NOT NULL REFERENCES entitlements(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  PRIMARY KEY (entitlement_id, product_id)
);

CREATE TABLE IF NOT EXISTS offerings (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  metadata TEXT NOT NULL DEFAULT '{}',
  is_current INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS packages (
  id TEXT PRIMARY KEY,
  offering_id TEXT NOT NULL REFERENCES offerings(id) ON DELETE CASCADE,
  identifier TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  UNIQUE (offering_id, identifier)
);

CREATE TABLE IF NOT EXISTS package_products (
  package_id TEXT NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  PRIMARY KEY (package_id, product_id)
);

CREATE TABLE IF NOT EXISTS subscribers (
  id TEXT PRIMARY KEY,
  original_app_user_id TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS aliases (
  app_user_id TEXT PRIMARY KEY,
  subscriber_id TEXT NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_aliases_subscriber ON aliases(subscriber_id);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  subscriber_id TEXT NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  product_store_identifier TEXT NOT NULL,
  store TEXT NOT NULL CHECK (store IN ('app_store','play_store','promotional')),
  purchase_date TEXT NOT NULL,
  original_purchase_date TEXT NOT NULL,
  expires_date TEXT,
  unsubscribe_detected_at TEXT,
  billing_issues_detected_at TEXT,
  grace_period_expires_date TEXT,
  is_sandbox INTEGER NOT NULL DEFAULT 0,
  period_type TEXT NOT NULL DEFAULT 'normal' CHECK (period_type IN ('normal','trial','intro')),
  will_renew INTEGER NOT NULL DEFAULT 1,
  UNIQUE (subscriber_id, product_store_identifier)
);

CREATE TABLE IF NOT EXISTS non_subscriptions (
  id TEXT PRIMARY KEY,
  subscriber_id TEXT NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  product_store_identifier TEXT NOT NULL,
  store TEXT NOT NULL CHECK (store IN ('app_store','play_store','promotional')),
  purchase_date TEXT NOT NULL,
  is_sandbox INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_non_subscriptions_subscriber ON non_subscriptions(subscriber_id);

CREATE TABLE IF NOT EXISTS subscriber_attributes (
  subscriber_id TEXT NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (subscriber_id, key)
);

CREATE TABLE IF NOT EXISTS experiments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','running','stopped')),
  control_offering_id TEXT NOT NULL REFERENCES offerings(id),
  treatment_offering_id TEXT NOT NULL REFERENCES offerings(id),
  traffic_pct INTEGER NOT NULL CHECK (traffic_pct BETWEEN 0 AND 100),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS experiment_enrollments (
  experiment_id TEXT NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  subscriber_id TEXT NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  variant TEXT NOT NULL CHECK (variant IN ('control','treatment')),
  enrolled_at TEXT NOT NULL,
  PRIMARY KEY (experiment_id, subscriber_id)
);

CREATE TABLE IF NOT EXISTS receipts (
  id TEXT PRIMARY KEY,
  store TEXT NOT NULL,
  fetch_token TEXT NOT NULL,
  subscriber_id TEXT NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  product_store_identifier TEXT NOT NULL,
  presented_offering_identifier TEXT,
  price REAL,
  currency TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (store, fetch_token)
);
CREATE INDEX IF NOT EXISTS idx_receipts_subscriber ON receipts(subscriber_id);

-- v2: SDK diagnostics, events, webhooks --

CREATE TABLE IF NOT EXISTS sdk_pings (
  app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  sdk_version TEXT,
  app_version TEXT,
  platform_version TEXT,
  last_seen TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (app_id, platform)
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  subscriber_id TEXT,
  app_user_id TEXT,
  product_store_identifier TEXT,
  store TEXT,
  price REAL,
  currency TEXT,
  period_type TEXT,
  expires_date TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_subscriber ON events(subscriber_id);

CREATE TABLE IF NOT EXISTS webhooks (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  events TEXT NOT NULL DEFAULT '*',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id TEXT PRIMARY KEY,
  webhook_id TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event_id TEXT,
  event_type TEXT NOT NULL,
  status_code INTEGER,
  ok INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook ON webhook_deliveries(webhook_id);
`;

export function openDb(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const version = db.pragma('user_version', { simple: true }) as number;
  // Base tables (idempotent CREATE IF NOT EXISTS), then forward-only ALTER migrations.
  if (version < BASE_SCHEMA_VERSION) {
    db.exec(SCHEMA);
    db.pragma(`user_version = ${BASE_SCHEMA_VERSION}`);
  }
  const current = db.pragma('user_version', { simple: true }) as number;
  if (current < LATEST_SCHEMA_VERSION) {
    runMigrations(db, current);
    db.pragma(`user_version = ${LATEST_SCHEMA_VERSION}`);
  }
  return db;
}
