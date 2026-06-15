import type { DB } from '../db.js';
import { nowIso } from '../ids.js';
import { entitlementsForStoreIdentifier } from '../repo/entitlements.js';
import { latestReceiptForProduct } from '../repo/receipts.js';
import {
  getAttributes,
  getNonSubscriptions,
  getSubscriptions,
  type SubscriberRow,
} from '../repo/subscribers.js';

/**
 * RevenueCat-compatible CustomerInfo. The field set and types mirror RevenueCat's
 * `GET /v1/subscribers/{id}` response so the official RevenueCat SDK can decode it
 * unchanged (drop-in migration via `Purchases.proxyURL`). Fields RevenueDog does not
 * yet source are emitted with RevenueCat's documented defaults (null / "PURCHASED" / {}).
 */
export interface CustomerInfo {
  request_date: string;
  request_date_ms: number;
  subscriber: {
    original_app_user_id: string;
    original_application_version: string | null;
    original_purchase_date: string | null;
    first_seen: string;
    last_seen: string;
    management_url: string | null;
    entitlements: Record<string, EntitlementInfo>;
    subscriptions: Record<string, SubscriptionInfo>;
    non_subscriptions: Record<string, NonSubscriptionInfo[]>;
    other_purchases: Record<string, never>;
    subscriber_attributes: Record<string, { value: string; updated_at_ms: number }>;
  };
}

interface EntitlementInfo {
  expires_date: string | null;
  purchase_date: string;
  product_identifier: string;
  grace_period_expires_date: string | null;
}

interface PriceInfo {
  amount: number;
  currency: string;
}

interface SubscriptionInfo {
  purchase_date: string;
  original_purchase_date: string;
  expires_date: string | null;
  store: string;
  unsubscribe_detected_at: string | null;
  billing_issues_detected_at: string | null;
  grace_period_expires_date: string | null;
  is_sandbox: boolean;
  ownership_type: 'PURCHASED' | 'FAMILY_SHARED';
  period_type: string;
  refunded_at: string | null;
  auto_resume_date: string | null;
  store_transaction_id: string | null;
  product_plan_identifier: string | null;
  price: PriceInfo | null;
  will_renew: boolean;
}

interface NonSubscriptionInfo {
  id: string;
  purchase_date: string;
  store: string;
  is_sandbox: boolean;
  store_transaction_id: string | null;
  price: PriceInfo | null;
}

/** RevenueCat dates carry an epoch-millisecond companion; null stays null. */
function ms(iso: string | null): number | null {
  return iso === null ? null : new Date(iso).getTime();
}

function isActive(expiresDate: string | null, now: number): boolean {
  if (expiresDate === null) return true;
  return new Date(expiresDate).getTime() > now;
}

/** Builds the API.md CustomerInfo shape for a resolved subscriber. */
export function buildCustomerInfo(db: DB, subscriber: SubscriberRow): CustomerInfo {
  const requestDate = nowIso();
  const now = Date.now();

  const subscriptions = getSubscriptions(db, subscriber.id);
  const nonSubscriptions = getNonSubscriptions(db, subscriber.id);
  const attributes = getAttributes(db, subscriber.id);

  const priceFrom = (storeId: string): { price: PriceInfo | null; transactionId: string | null } => {
    const r = latestReceiptForProduct(db, subscriber.id, storeId);
    const price = r && r.price !== null ? { amount: r.price, currency: r.currency ?? 'USD' } : null;
    return { price, transactionId: r?.fetch_token ?? null };
  };

  const subscriptionsOut: Record<string, SubscriptionInfo> = {};
  for (const s of subscriptions) {
    const { price, transactionId } = priceFrom(s.product_store_identifier);
    subscriptionsOut[s.product_store_identifier] = {
      purchase_date: s.purchase_date,
      original_purchase_date: s.original_purchase_date,
      expires_date: s.expires_date,
      store: s.store,
      unsubscribe_detected_at: s.unsubscribe_detected_at,
      billing_issues_detected_at: s.billing_issues_detected_at,
      grace_period_expires_date: s.grace_period_expires_date,
      is_sandbox: !!s.is_sandbox,
      ownership_type: 'PURCHASED',
      period_type: s.period_type,
      refunded_at: null,
      auto_resume_date: null,
      store_transaction_id: transactionId,
      product_plan_identifier: null,
      price,
      will_renew: !!s.will_renew,
    };
  }

  const nonSubscriptionsOut: Record<string, NonSubscriptionInfo[]> = {};
  for (const n of nonSubscriptions) {
    const { price, transactionId } = priceFrom(n.product_store_identifier);
    (nonSubscriptionsOut[n.product_store_identifier] ??= []).push({
      id: n.id,
      purchase_date: n.purchase_date,
      store: n.store,
      is_sandbox: !!n.is_sandbox,
      store_transaction_id: transactionId,
      price,
    });
  }

  const entitlements: Record<string, EntitlementInfo> = {};
  const grant = (storeId: string, expiresDate: string | null, purchaseDate: string, gracePeriod: string | null) => {
    if (!isActive(expiresDate, now)) return;
    for (const ent of entitlementsForStoreIdentifier(db, storeId)) {
      const current = entitlements[ent.identifier];
      const candidate: EntitlementInfo = {
        expires_date: expiresDate,
        purchase_date: purchaseDate,
        product_identifier: storeId,
        grace_period_expires_date: gracePeriod,
      };
      // Prefer the longest-lived grant (lifetime beats dated; later expiry wins).
      if (!current) entitlements[ent.identifier] = candidate;
      else if (current.expires_date !== null && (expiresDate === null || new Date(expiresDate) > new Date(current.expires_date))) {
        entitlements[ent.identifier] = candidate;
      }
    }
  };

  for (const s of subscriptions) grant(s.product_store_identifier, s.expires_date, s.purchase_date, s.grace_period_expires_date);
  for (const n of nonSubscriptions) grant(n.product_store_identifier, null, n.purchase_date, null);

  const attributesOut: Record<string, { value: string; updated_at_ms: number }> = {};
  for (const a of attributes) attributesOut[a.key] = { value: a.value, updated_at_ms: ms(a.updated_at)! };

  // RevenueCat's original_purchase_date is the earliest purchase the subscriber ever made.
  const allPurchaseDates = [
    ...subscriptions.map((s) => s.original_purchase_date),
    ...nonSubscriptions.map((n) => n.purchase_date),
  ];
  const originalPurchaseDate =
    allPurchaseDates.length > 0
      ? allPurchaseDates.reduce((min, d) => (new Date(d) < new Date(min) ? d : min))
      : null;

  return {
    request_date: requestDate,
    request_date_ms: ms(requestDate)!,
    subscriber: {
      original_app_user_id: subscriber.original_app_user_id,
      original_application_version: null,
      original_purchase_date: originalPurchaseDate,
      first_seen: subscriber.first_seen,
      last_seen: subscriber.last_seen,
      management_url: null,
      entitlements,
      subscriptions: subscriptionsOut,
      non_subscriptions: nonSubscriptionsOut,
      other_purchases: {},
      subscriber_attributes: attributesOut,
    },
  };
}
