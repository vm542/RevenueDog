import type { DB } from '../db.js';
import { genId, nowIso } from '../ids.js';

export type EventType =
  | 'initial_purchase'
  | 'renewal'
  | 'trial_started'
  | 'non_renewing_purchase'
  | 'promotional_grant'
  | 'expiration'
  | 'billing_issue'
  | 'cancellation';

export interface EventRow {
  id: string;
  type: EventType;
  subscriber_id: string | null;
  app_user_id: string | null;
  product_store_identifier: string | null;
  store: string | null;
  price: number | null;
  currency: string | null;
  period_type: string | null;
  expires_date: string | null;
  created_at: string;
}

export interface RecordEventInput {
  type: EventType;
  subscriberId?: string | null;
  appUserId?: string | null;
  productStoreIdentifier?: string | null;
  store?: string | null;
  price?: number | null;
  currency?: string | null;
  periodType?: string | null;
  expiresDate?: string | null;
  createdAt?: string;
}

export function recordEvent(db: DB, input: RecordEventInput): EventRow {
  const row: EventRow = {
    id: genId('evt'),
    type: input.type,
    subscriber_id: input.subscriberId ?? null,
    app_user_id: input.appUserId ?? null,
    product_store_identifier: input.productStoreIdentifier ?? null,
    store: input.store ?? null,
    price: input.price ?? null,
    currency: input.currency ?? null,
    period_type: input.periodType ?? null,
    expires_date: input.expiresDate ?? null,
    created_at: input.createdAt ?? nowIso(),
  };
  db.prepare(
    `INSERT INTO events (id, type, subscriber_id, app_user_id, product_store_identifier, store, price, currency, period_type, expires_date, created_at)
     VALUES (@id, @type, @subscriber_id, @app_user_id, @product_store_identifier, @store, @price, @currency, @period_type, @expires_date, @created_at)`,
  ).run(row);
  return row;
}

export function listEvents(db: DB, limit = 50): EventRow[] {
  return db.prepare('SELECT * FROM events ORDER BY created_at DESC LIMIT ?').all(limit) as EventRow[];
}

export function hasExpirationEvent(db: DB, subscriberId: string, productStoreIdentifier: string, expiresDate: string): boolean {
  return !!db
    .prepare(
      "SELECT id FROM events WHERE type = 'expiration' AND subscriber_id = ? AND product_store_identifier = ? AND expires_date = ?",
    )
    .get(subscriberId, productStoreIdentifier, expiresDate);
}
