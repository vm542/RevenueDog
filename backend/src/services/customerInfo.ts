import type { DB } from '../db.js';
import { nowIso } from '../ids.js';
import { entitlementsForStoreIdentifier } from '../repo/entitlements.js';
import {
  getAttributes,
  getNonSubscriptions,
  getSubscriptions,
  type SubscriberRow,
} from '../repo/subscribers.js';

export interface CustomerInfo {
  request_date: string;
  subscriber: {
    original_app_user_id: string;
    first_seen: string;
    last_seen: string;
    management_url: string | null;
    entitlements: Record<string, EntitlementInfo>;
    subscriptions: Record<string, SubscriptionInfo>;
    non_subscriptions: Record<string, NonSubscriptionInfo[]>;
    subscriber_attributes: Record<string, { value: string; updated_at: string }>;
  };
}

interface EntitlementInfo {
  expires_date: string | null;
  purchase_date: string;
  product_identifier: string;
  grace_period_expires_date: string | null;
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
  period_type: string;
  will_renew: boolean;
}

interface NonSubscriptionInfo {
  id: string;
  purchase_date: string;
  store: string;
  is_sandbox: boolean;
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

  const subscriptionsOut: Record<string, SubscriptionInfo> = {};
  for (const s of subscriptions) {
    subscriptionsOut[s.product_store_identifier] = {
      purchase_date: s.purchase_date,
      original_purchase_date: s.original_purchase_date,
      expires_date: s.expires_date,
      store: s.store,
      unsubscribe_detected_at: s.unsubscribe_detected_at,
      billing_issues_detected_at: s.billing_issues_detected_at,
      grace_period_expires_date: s.grace_period_expires_date,
      is_sandbox: !!s.is_sandbox,
      period_type: s.period_type,
      will_renew: !!s.will_renew,
    };
  }

  const nonSubscriptionsOut: Record<string, NonSubscriptionInfo[]> = {};
  for (const n of nonSubscriptions) {
    (nonSubscriptionsOut[n.product_store_identifier] ??= []).push({
      id: n.id,
      purchase_date: n.purchase_date,
      store: n.store,
      is_sandbox: !!n.is_sandbox,
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

  const attributesOut: Record<string, { value: string; updated_at: string }> = {};
  for (const a of attributes) attributesOut[a.key] = { value: a.value, updated_at: a.updated_at };

  return {
    request_date: requestDate,
    subscriber: {
      original_app_user_id: subscriber.original_app_user_id,
      first_seen: subscriber.first_seen,
      last_seen: subscriber.last_seen,
      management_url: null,
      entitlements,
      subscriptions: subscriptionsOut,
      non_subscriptions: nonSubscriptionsOut,
      subscriber_attributes: attributesOut,
    },
  };
}
