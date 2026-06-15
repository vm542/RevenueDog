import type { DB } from '../db.js';
import { notFound } from '../errors.js';
import { genId, genKey, nowIso } from '../ids.js';

export interface WebhookRow {
  id: string;
  url: string;
  secret: string;
  events: string; // '*' or JSON array of event types
  active: number;
  created_at: string;
}

export interface Webhook {
  id: string;
  url: string;
  secret: string;
  events: string[] | '*';
  active: boolean;
  created_at: string;
}

function hydrate(row: WebhookRow): Webhook {
  return {
    id: row.id,
    url: row.url,
    secret: row.secret,
    events: row.events === '*' ? '*' : (JSON.parse(row.events) as string[]),
    active: !!row.active,
    created_at: row.created_at,
  };
}

export function createWebhook(
  db: DB,
  projectId: string,
  input: { url: string; events?: string[] | '*'; active?: boolean },
): Webhook {
  const row: WebhookRow = {
    id: genId('wh'),
    url: input.url,
    secret: genKey('sk').replace('sk_', 'whsec_'),
    events: !input.events || input.events === '*' ? '*' : JSON.stringify(input.events),
    active: input.active === false ? 0 : 1,
    created_at: nowIso(),
  };
  db.prepare(
    'INSERT INTO webhooks (id, project_id, url, secret, events, active, created_at) VALUES (@id, @project_id, @url, @secret, @events, @active, @created_at)',
  ).run({ ...row, project_id: projectId });
  return hydrate(row);
}

export function listWebhooks(db: DB, projectId: string): Webhook[] {
  return (
    db.prepare('SELECT * FROM webhooks WHERE project_id = ? ORDER BY created_at ASC').all(projectId) as WebhookRow[]
  ).map(hydrate);
}

export function getWebhook(db: DB, projectId: string, id: string): Webhook | undefined {
  const row = db.prepare('SELECT * FROM webhooks WHERE id = ? AND project_id = ?').get(id, projectId) as
    | WebhookRow
    | undefined;
  return row ? hydrate(row) : undefined;
}

/** Active webhooks for a project — used when dispatching that project's events. */
export function activeWebhooks(db: DB, projectId: string): Webhook[] {
  return (
    db.prepare('SELECT * FROM webhooks WHERE project_id = ? AND active = 1').all(projectId) as WebhookRow[]
  ).map(hydrate);
}

export function updateWebhook(
  db: DB,
  projectId: string,
  id: string,
  patch: { url?: string; events?: string[] | '*'; active?: boolean },
): Webhook {
  const existing = db.prepare('SELECT * FROM webhooks WHERE id = ? AND project_id = ?').get(id, projectId) as
    | WebhookRow
    | undefined;
  if (!existing) throw notFound('No webhook with that id.');
  const next: WebhookRow = {
    ...existing,
    url: patch.url ?? existing.url,
    events: patch.events === undefined ? existing.events : patch.events === '*' ? '*' : JSON.stringify(patch.events),
    active: patch.active === undefined ? existing.active : patch.active ? 1 : 0,
  };
  db.prepare('UPDATE webhooks SET url=@url, events=@events, active=@active WHERE id=@id').run(next);
  return hydrate(next);
}

export function deleteWebhook(db: DB, projectId: string, id: string): boolean {
  return db.prepare('DELETE FROM webhooks WHERE id = ? AND project_id = ?').run(id, projectId).changes > 0;
}

export interface DeliveryRow {
  id: string;
  webhook_id: string;
  event_id: string | null;
  event_type: string;
  status_code: number | null;
  ok: number;
  error: string | null;
  created_at: string;
}

export function recordDelivery(
  db: DB,
  input: { webhookId: string; eventId: string | null; eventType: string; statusCode: number | null; ok: boolean; error?: string | null },
): void {
  db.prepare(
    `INSERT INTO webhook_deliveries (id, webhook_id, event_id, event_type, status_code, ok, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(genId('whd'), input.webhookId, input.eventId, input.eventType, input.statusCode, input.ok ? 1 : 0, input.error ?? null, nowIso());
}

export function listDeliveries(db: DB, webhookId: string, limit = 50): DeliveryRow[] {
  return db
    .prepare('SELECT * FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(webhookId, limit) as DeliveryRow[];
}
