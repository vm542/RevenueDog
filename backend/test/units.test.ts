import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { assertProductionSafe, loadConfig } from '../src/config.js';
import { openDb, SCHEMA } from '../src/db.js';
import { addDuration, isValidDuration } from '../src/duration.js';
import { LATEST_SCHEMA_VERSION, runMigrations } from '../src/migrations.js';

describe('migrations', () => {
  it('upgrades a v2 database: platform keys, default tenant, and data adoption', () => {
    // Build a realistic pre-migration (v2) database with one app and one product.
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(SCHEMA);
    db.prepare(
      `INSERT INTO apps (id, name, public_api_key, created_at) VALUES (?, ?, ?, ?)`,
    ).run('app_legacy', 'Legacy', 'pk_legacy', '2026-01-01T00:00:00Z');
    db.prepare(
      `INSERT INTO products (id, store_identifier, type, store, display_name) VALUES (?, ?, ?, ?, ?)`,
    ).run('prod_legacy', 'com.legacy.pro', 'subscription', 'app_store', 'Pro');
    db.pragma('user_version = 2');

    runMigrations(db, 2);

    // v3: platform keys backfilled.
    const app = db.prepare('SELECT * FROM apps WHERE id = ?').get('app_legacy') as {
      apple_api_key: string;
      google_api_key: string;
      project_id: string;
    };
    expect(app.apple_api_key).toMatch(/^appl_/);
    expect(app.google_api_key).toMatch(/^goog_/);

    // v4: a default project exists, and existing rows were adopted into it.
    const defaultProject = db.prepare("SELECT value FROM meta WHERE key = 'default_project_id'").get() as {
      value: string;
    };
    expect(defaultProject.value).toMatch(/^proj_/);
    expect(app.project_id).toBe(defaultProject.value);
    const product = db.prepare('SELECT project_id FROM products WHERE id = ?').get('prod_legacy') as {
      project_id: string;
    };
    expect(product.project_id).toBe(defaultProject.value);
    db.close();
  });

  it('openDb provisions a fresh database at the latest schema version', () => {
    const db = openDb(':memory:');
    expect(db.pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION);
    db.close();
  });
});

describe('production safety guard', () => {
  const prod = (over: NodeJS.ProcessEnv) =>
    loadConfig({ NODE_ENV: 'production', CORS_ORIGIN: 'https://dash.example.com', ...over } as NodeJS.ProcessEnv);

  it('refuses to boot in production with trust-mode validation', () => {
    expect(() => assertProductionSafe(prod({}))).toThrow(/trust-mode/i);
  });

  it('refuses to boot in production with wildcard CORS', () => {
    expect(() =>
      assertProductionSafe(prod({ APPLE_VALIDATION: 'apple', GOOGLE_VALIDATION: 'google', CORS_ORIGIN: '*' })),
    ).toThrow(/CORS/i);
  });

  it('allows a properly configured production server', () => {
    expect(() =>
      assertProductionSafe(prod({ APPLE_VALIDATION: 'apple', GOOGLE_VALIDATION: 'google' })),
    ).not.toThrow();
  });

  it('never blocks non-production environments', () => {
    expect(() => assertProductionSafe(loadConfig({} as NodeJS.ProcessEnv))).not.toThrow();
  });
});

describe('duration', () => {
  it('validates ISO-8601 durations', () => {
    expect(isValidDuration('P1M')).toBe(true);
    expect(isValidDuration('P1Y')).toBe(true);
    expect(isValidDuration('P7D')).toBe(true);
    expect(isValidDuration('P1W')).toBe(true);
    expect(isValidDuration('P')).toBe(false);
    expect(isValidDuration('1M')).toBe(false);
    expect(isValidDuration('PXM')).toBe(false);
  });

  it('adds calendar durations in UTC', () => {
    expect(addDuration('2026-01-15T00:00:00Z', 'P1M')).toBe('2026-02-15T00:00:00Z');
    expect(addDuration('2026-01-15T00:00:00Z', 'P1Y')).toBe('2027-01-15T00:00:00Z');
    expect(addDuration('2026-01-01T00:00:00Z', 'P7D')).toBe('2026-01-08T00:00:00Z');
    expect(addDuration('2026-01-01T00:00:00Z', 'P1W')).toBe('2026-01-08T00:00:00Z');
  });
});
