import { createHmac } from 'node:crypto';
import type { DB } from '../db.js';
import { recordEvent, hasExpirationEvent, type EventType, type RecordEventInput } from '../repo/events.js';
import { activeWebhooks, recordDelivery } from '../repo/webhooks.js';

export interface EmitInput extends RecordEventInput {
  type: EventType;
}

/**
 * Records an event and asynchronously delivers it to every active webhook subscribed
 * to its type. Delivery is best-effort and never blocks the caller's request.
 */
export function emitEvent(db: DB, input: EmitInput): void {
  const event = recordEvent(db, input);
  const payload = {
    api_version: '1.0',
    event: {
      id: event.id,
      type: event.type,
      app_user_id: event.app_user_id,
      product_id: event.product_store_identifier,
      store: event.store,
      price: event.price,
      currency: event.currency,
      period_type: event.period_type,
      expiration_at: event.expires_date,
      event_timestamp: event.created_at,
    },
  };
  const body = JSON.stringify(payload);

  for (const wh of activeWebhooks(db, input.projectId)) {
    if (wh.events !== '*' && !wh.events.includes(event.type)) continue;
    const signature = createHmac('sha256', wh.secret).update(body).digest('hex');
    void deliver(db, wh.id, event.id, event.type, wh.url, body, signature);
  }
}

async function deliver(
  db: DB,
  webhookId: string,
  eventId: string,
  eventType: string,
  url: string,
  body: string,
  signature: string,
): Promise<void> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-RevenueDog-Signature': signature,
        'User-Agent': 'RevenueDog-Webhook/0.1.0',
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    safeRecordDelivery(db, { webhookId, eventId, eventType, statusCode: res.status, ok: res.ok });
  } catch (err) {
    safeRecordDelivery(db, {
      webhookId,
      eventId,
      eventType,
      statusCode: null,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Recording delivery is best-effort: this runs after the response, so a closed DB
 *  (e.g. during shutdown/tests) must not surface as an unhandled rejection. */
function safeRecordDelivery(db: DB, input: Parameters<typeof recordDelivery>[1]): void {
  try {
    recordDelivery(db, input);
  } catch {
    // ignore — the request has already been delivered (or failed to deliver)
  }
}

/**
 * Detects subscriptions that have lapsed since the last check and emits `expiration`
 * (and `billing_issue`) events exactly once each. Intended to run periodically.
 */
export function checkExpirations(db: DB): number {
  const now = Date.now();
  const lapsed = db
    .prepare(
      `SELECT s.project_id, s.subscriber_id, s.product_store_identifier, s.store, s.expires_date, s.period_type, s.billing_issues_detected_at,
              (SELECT a.app_user_id FROM aliases a WHERE a.subscriber_id = s.subscriber_id LIMIT 1) AS app_user_id
       FROM subscriptions s
       WHERE s.expires_date IS NOT NULL AND s.expires_date < ? AND s.store != 'promotional'`,
    )
    .all(new Date(now).toISOString()) as {
    project_id: string;
    subscriber_id: string;
    product_store_identifier: string;
    store: string;
    expires_date: string;
    period_type: string;
    billing_issues_detected_at: string | null;
    app_user_id: string | null;
  }[];

  let emitted = 0;
  for (const s of lapsed) {
    if (hasExpirationEvent(db, s.subscriber_id, s.product_store_identifier, s.expires_date)) continue;
    emitEvent(db, {
      projectId: s.project_id,
      type: s.billing_issues_detected_at ? 'billing_issue' : 'expiration',
      subscriberId: s.subscriber_id,
      appUserId: s.app_user_id,
      productStoreIdentifier: s.product_store_identifier,
      store: s.store,
      periodType: s.period_type,
      expiresDate: s.expires_date,
    });
    emitted++;
  }
  return emitted;
}
