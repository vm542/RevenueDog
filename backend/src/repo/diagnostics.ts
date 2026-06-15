import type { FastifyRequest } from 'fastify';
import type { DB } from '../db.js';
import { nowIso } from '../ids.js';

export interface SdkPing {
  app_id: string;
  platform: string;
  sdk_version: string | null;
  app_version: string | null;
  platform_version: string | null;
  last_seen: string;
  first_seen: string;
  request_count: number;
}

/** Records an SDK request against an app, for the dashboard's connection indicator. */
export function recordSdkPing(db: DB, appId: string, req: FastifyRequest): void {
  const h = req.headers;
  const platform = String(h['x-platform'] ?? 'unknown').toLowerCase();
  const sdkVersion = (h['x-sdk-version'] as string) ?? null;
  const appVersion = (h['x-app-version'] as string) ?? null;
  const platformVersion = (h['x-platform-version'] as string) ?? null;
  const now = nowIso();
  db.prepare(
    `INSERT INTO sdk_pings (app_id, platform, sdk_version, app_version, platform_version, last_seen, first_seen, request_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT(app_id, platform) DO UPDATE SET
       sdk_version = excluded.sdk_version,
       app_version = excluded.app_version,
       platform_version = excluded.platform_version,
       last_seen = excluded.last_seen,
       request_count = sdk_pings.request_count + 1`,
  ).run(appId, platform, sdkVersion, appVersion, platformVersion, now, now);
}

export function pingsForApp(db: DB, appId: string): SdkPing[] {
  return db.prepare('SELECT * FROM sdk_pings WHERE app_id = ? ORDER BY platform ASC').all(appId) as SdkPing[];
}

export function allPings(db: DB): SdkPing[] {
  return db.prepare('SELECT * FROM sdk_pings ORDER BY last_seen DESC').all() as SdkPing[];
}

function count(db: DB, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
}

export interface Diagnostics {
  backend_version: string;
  generated_at: string;
  validation: { app_store: string; play_store: string };
  totals: { apps: number; products: number; entitlements: number; offerings: number; subscribers: number; events: number };
  apps: {
    id: string;
    name: string;
    connected: boolean;
    last_seen: string | null;
    platforms: { platform: string; sdk_version: string | null; app_version: string | null; last_seen: string; request_count: number }[];
  }[];
}

export function buildDiagnostics(db: DB, validation: { app_store: string; play_store: string }): Diagnostics {
  const apps = db.prepare('SELECT id, name FROM apps ORDER BY created_at ASC').all() as { id: string; name: string }[];
  return {
    backend_version: '0.1.0',
    generated_at: nowIso(),
    validation,
    totals: {
      apps: apps.length,
      products: count(db, 'products'),
      entitlements: count(db, 'entitlements'),
      offerings: count(db, 'offerings'),
      subscribers: count(db, 'subscribers'),
      events: count(db, 'events'),
    },
    apps: apps.map((a) => {
      const pings = pingsForApp(db, a.id);
      const lastSeen = pings.length ? pings.map((p) => p.last_seen).sort().at(-1)! : null;
      return {
        id: a.id,
        name: a.name,
        connected: pings.length > 0,
        last_seen: lastSeen,
        platforms: pings.map((p) => ({
          platform: p.platform,
          sdk_version: p.sdk_version,
          app_version: p.app_version,
          last_seen: p.last_seen,
          request_count: p.request_count,
        })),
      };
    }),
  };
}
