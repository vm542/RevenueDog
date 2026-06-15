import type { DB } from '../db.js';
import { genId, nowIso } from '../ids.js';

export type SubStore = 'app_store' | 'play_store' | 'promotional';
export type PeriodType = 'normal' | 'trial' | 'intro';

export interface SubscriberRow {
  id: string;
  project_id: string;
  original_app_user_id: string;
  first_seen: string;
  last_seen: string;
}

export interface SubscriptionRow {
  id: string;
  project_id: string;
  subscriber_id: string;
  product_store_identifier: string;
  store: SubStore;
  purchase_date: string;
  original_purchase_date: string;
  expires_date: string | null;
  unsubscribe_detected_at: string | null;
  billing_issues_detected_at: string | null;
  grace_period_expires_date: string | null;
  is_sandbox: number;
  period_type: PeriodType;
  will_renew: number;
}

export interface NonSubscriptionRow {
  id: string;
  project_id: string;
  subscriber_id: string;
  product_store_identifier: string;
  store: SubStore;
  purchase_date: string;
  is_sandbox: number;
}

export interface AttributeRow {
  key: string;
  value: string;
  updated_at: string;
}

/** Resolves an app_user_id to its subscriber within a project, following aliases. */
export function findSubscriber(db: DB, projectId: string, appUserId: string): SubscriberRow | undefined {
  const alias = db
    .prepare('SELECT subscriber_id FROM aliases WHERE project_id = ? AND app_user_id = ?')
    .get(projectId, appUserId) as { subscriber_id: string } | undefined;
  if (!alias) return undefined;
  return db.prepare('SELECT * FROM subscribers WHERE id = ?').get(alias.subscriber_id) as
    | SubscriberRow
    | undefined;
}

/** Resolves or creates a subscriber for the given app_user_id within a project. */
export function getOrCreateSubscriber(
  db: DB,
  projectId: string,
  appUserId: string,
): { subscriber: SubscriberRow; created: boolean } {
  const existing = findSubscriber(db, projectId, appUserId);
  if (existing) {
    db.prepare('UPDATE subscribers SET last_seen = ? WHERE id = ?').run(nowIso(), existing.id);
    return { subscriber: { ...existing, last_seen: nowIso() }, created: false };
  }
  const now = nowIso();
  const sub: SubscriberRow = {
    id: genId('sub'),
    project_id: projectId,
    original_app_user_id: appUserId,
    first_seen: now,
    last_seen: now,
  };
  db.transaction(() => {
    db.prepare(
      'INSERT INTO subscribers (id, project_id, original_app_user_id, first_seen, last_seen) VALUES (@id, @project_id, @original_app_user_id, @first_seen, @last_seen)',
    ).run(sub);
    db.prepare('INSERT INTO aliases (project_id, app_user_id, subscriber_id) VALUES (?, ?, ?)').run(
      projectId,
      appUserId,
      sub.id,
    );
  })();
  return { subscriber: sub, created: true };
}

export function listAliases(db: DB, subscriberId: string): string[] {
  return (
    db.prepare('SELECT app_user_id FROM aliases WHERE subscriber_id = ?').all(subscriberId) as {
      app_user_id: string;
    }[]
  ).map((r) => r.app_user_id);
}

/** Aliases `newAppUserId` to the subscriber currently resolved by `appUserId`, merging if needed. */
export function aliasSubscriber(
  db: DB,
  projectId: string,
  appUserId: string,
  newAppUserId: string,
): { subscriber: SubscriberRow; created: boolean } {
  return db.transaction(() => {
    const current = getOrCreateSubscriber(db, projectId, appUserId).subscriber;
    const target = findSubscriber(db, projectId, newAppUserId);
    if (!target) {
      db.prepare('INSERT INTO aliases (project_id, app_user_id, subscriber_id) VALUES (?, ?, ?)').run(
        projectId,
        newAppUserId,
        current.id,
      );
      return { subscriber: current, created: true };
    }
    if (target.id === current.id) return { subscriber: current, created: false };
    // Merge: move everything from `current` into `target`, then repoint aliases.
    mergeSubscribers(db, current.id, target.id);
    return { subscriber: target, created: false };
  })();
}

function mergeSubscribers(db: DB, fromId: string, intoId: string): void {
  db.prepare('UPDATE aliases SET subscriber_id = ? WHERE subscriber_id = ?').run(intoId, fromId);
  // Move subscriptions, skipping ones that would violate the unique (subscriber, product) constraint.
  const subs = db.prepare('SELECT * FROM subscriptions WHERE subscriber_id = ?').all(fromId) as SubscriptionRow[];
  for (const s of subs) {
    const clash = db
      .prepare('SELECT id FROM subscriptions WHERE subscriber_id = ? AND product_store_identifier = ?')
      .get(intoId, s.product_store_identifier);
    if (clash) db.prepare('DELETE FROM subscriptions WHERE id = ?').run(s.id);
    else db.prepare('UPDATE subscriptions SET subscriber_id = ? WHERE id = ?').run(intoId, s.id);
  }
  db.prepare('UPDATE non_subscriptions SET subscriber_id = ? WHERE subscriber_id = ?').run(intoId, fromId);
  db.prepare('UPDATE receipts SET subscriber_id = ? WHERE subscriber_id = ?').run(intoId, fromId);
  // Attributes: keep target's on conflict.
  const attrs = db.prepare('SELECT * FROM subscriber_attributes WHERE subscriber_id = ?').all(fromId) as
    (AttributeRow & { subscriber_id: string })[];
  for (const a of attrs) {
    const clash = db
      .prepare('SELECT key FROM subscriber_attributes WHERE subscriber_id = ? AND key = ?')
      .get(intoId, a.key);
    if (!clash) {
      db.prepare(
        'UPDATE subscriber_attributes SET subscriber_id = ? WHERE subscriber_id = ? AND key = ?',
      ).run(intoId, fromId, a.key);
    }
  }
  db.prepare('DELETE FROM experiment_enrollments WHERE subscriber_id = ?').run(fromId);
  db.prepare('DELETE FROM subscribers WHERE id = ?').run(fromId);
}

export function deleteSubscriber(db: DB, projectId: string, appUserId: string): boolean {
  const sub = findSubscriber(db, projectId, appUserId);
  if (!sub) return false;
  db.prepare('DELETE FROM subscribers WHERE id = ?').run(sub.id);
  return true;
}

export function getSubscriptions(db: DB, subscriberId: string): SubscriptionRow[] {
  return db
    .prepare('SELECT * FROM subscriptions WHERE subscriber_id = ? ORDER BY purchase_date DESC')
    .all(subscriberId) as SubscriptionRow[];
}

export function getNonSubscriptions(db: DB, subscriberId: string): NonSubscriptionRow[] {
  return db
    .prepare('SELECT * FROM non_subscriptions WHERE subscriber_id = ? ORDER BY purchase_date DESC')
    .all(subscriberId) as NonSubscriptionRow[];
}

export function getAttributes(db: DB, subscriberId: string): AttributeRow[] {
  return db
    .prepare('SELECT key, value, updated_at FROM subscriber_attributes WHERE subscriber_id = ?')
    .all(subscriberId) as AttributeRow[];
}

export function setAttribute(db: DB, subscriberId: string, key: string, value: string | null): void {
  if (value === null) {
    db.prepare('DELETE FROM subscriber_attributes WHERE subscriber_id = ? AND key = ?').run(subscriberId, key);
    return;
  }
  db.prepare(
    `INSERT INTO subscriber_attributes (subscriber_id, key, value, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(subscriber_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(subscriberId, key, value, nowIso());
}

export interface UpsertSubscriptionInput {
  projectId: string;
  subscriberId: string;
  productStoreIdentifier: string;
  store: SubStore;
  purchaseDate: string;
  expiresDate: string | null;
  periodType?: PeriodType;
  isSandbox?: boolean;
  willRenew?: boolean;
}

export function upsertSubscription(db: DB, input: UpsertSubscriptionInput): SubscriptionRow {
  const existing = db
    .prepare('SELECT * FROM subscriptions WHERE subscriber_id = ? AND product_store_identifier = ?')
    .get(input.subscriberId, input.productStoreIdentifier) as SubscriptionRow | undefined;
  if (existing) {
    const next: SubscriptionRow = {
      ...existing,
      purchase_date: input.purchaseDate,
      expires_date: input.expiresDate,
      store: input.store,
      period_type: input.periodType ?? existing.period_type,
      is_sandbox: input.isSandbox ? 1 : existing.is_sandbox,
      will_renew: input.willRenew === false ? 0 : 1,
    };
    db.prepare(
      `UPDATE subscriptions SET purchase_date=@purchase_date, expires_date=@expires_date, store=@store,
        period_type=@period_type, is_sandbox=@is_sandbox, will_renew=@will_renew WHERE id=@id`,
    ).run(next);
    return next;
  }
  const row: SubscriptionRow = {
    id: genId('subscription'),
    project_id: input.projectId,
    subscriber_id: input.subscriberId,
    product_store_identifier: input.productStoreIdentifier,
    store: input.store,
    purchase_date: input.purchaseDate,
    original_purchase_date: input.purchaseDate,
    expires_date: input.expiresDate,
    unsubscribe_detected_at: null,
    billing_issues_detected_at: null,
    grace_period_expires_date: null,
    is_sandbox: input.isSandbox ? 1 : 0,
    period_type: input.periodType ?? 'normal',
    will_renew: input.willRenew === false ? 0 : 1,
  };
  db.prepare(
    `INSERT INTO subscriptions (id, project_id, subscriber_id, product_store_identifier, store, purchase_date,
      original_purchase_date, expires_date, unsubscribe_detected_at, billing_issues_detected_at,
      grace_period_expires_date, is_sandbox, period_type, will_renew)
     VALUES (@id, @project_id, @subscriber_id, @product_store_identifier, @store, @purchase_date, @original_purchase_date,
      @expires_date, @unsubscribe_detected_at, @billing_issues_detected_at, @grace_period_expires_date,
      @is_sandbox, @period_type, @will_renew)`,
  ).run(row);
  return row;
}

export function insertNonSubscription(
  db: DB,
  input: { projectId: string; subscriberId: string; productStoreIdentifier: string; store: SubStore; purchaseDate: string; isSandbox?: boolean },
): NonSubscriptionRow {
  const row: NonSubscriptionRow = {
    id: genId('txn'),
    project_id: input.projectId,
    subscriber_id: input.subscriberId,
    product_store_identifier: input.productStoreIdentifier,
    store: input.store,
    purchase_date: input.purchaseDate,
    is_sandbox: input.isSandbox ? 1 : 0,
  };
  db.prepare(
    `INSERT INTO non_subscriptions (id, project_id, subscriber_id, product_store_identifier, store, purchase_date, is_sandbox)
     VALUES (@id, @project_id, @subscriber_id, @product_store_identifier, @store, @purchase_date, @is_sandbox)`,
  ).run(row);
  return row;
}

export function listSubscribers(db: DB, projectId: string, limit = 100, offset = 0): SubscriberRow[] {
  return db
    .prepare('SELECT * FROM subscribers WHERE project_id = ? ORDER BY last_seen DESC LIMIT ? OFFSET ?')
    .all(projectId, limit, offset) as SubscriberRow[];
}

export function countSubscribers(db: DB, projectId: string): number {
  return (
    db.prepare('SELECT COUNT(*) AS c FROM subscribers WHERE project_id = ?').get(projectId) as { c: number }
  ).c;
}
