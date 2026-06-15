import type { Config } from '../config.js';
import type { DB } from '../db.js';
import { nowIso } from '../ids.js';
import { getAppByBundleId, getAppByPackageName } from '../repo/apps.js';
import { findReceipt } from '../repo/receipts.js';
import {
  findSubscriber,
  updateSubscriptionFields,
  upsertSubscription,
  type SubscriptionFieldUpdate,
} from '../repo/subscribers.js';
import { decodeJwsPayload, verifyAppleJws } from './jws.js';
import { emitEvent } from './webhooks.js';
import type { EventType } from '../repo/events.js';

export interface NotificationResult {
  ok: boolean;
  reason?: string;
  handled?: string;
}

// ----------------------------------------------------------------------------
// Apple — App Store Server Notifications V2
// ----------------------------------------------------------------------------

interface AppleNotificationPayload {
  notificationType: string;
  subtype?: string;
  data?: {
    bundleId?: string;
    environment?: string;
    signedTransactionInfo?: string;
    signedRenewalInfo?: string;
  };
}
interface AppleTransactionInfo {
  productId?: string;
  appAccountToken?: string;
  originalTransactionId?: string;
  expiresDate?: number; // epoch ms
}
interface AppleRenewalInfo {
  autoRenewStatus?: number; // 0 disabled, 1 enabled
  gracePeriodExpiresDate?: number; // epoch ms
}

function msToIso(ms: number | undefined): string | undefined {
  return ms ? new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z') : undefined;
}

export function processAppleNotification(db: DB, config: Config, signedPayload: string): NotificationResult {
  const verify = config.appleValidation === 'apple';
  const rootCa = process.env.APPLE_ROOT_CA_PEM;
  const decode = <T>(jws: string): T => (verify ? verifyAppleJws<T>(jws, rootCa) : decodeJwsPayload<T>(jws));

  const payload = decode<AppleNotificationPayload>(signedPayload);
  if (payload.notificationType === 'TEST') return { ok: true, handled: 'TEST' };

  const data = payload.data ?? {};
  if (!data.bundleId) return { ok: false, reason: 'missing_bundle_id' };
  const app = getAppByBundleId(db, data.bundleId);
  if (!app) return { ok: false, reason: 'unknown_bundle_id' };

  const tx = data.signedTransactionInfo ? decode<AppleTransactionInfo>(data.signedTransactionInfo) : {};
  const renewal = data.signedRenewalInfo ? decode<AppleRenewalInfo>(data.signedRenewalInfo) : {};

  if (!tx.appAccountToken) return { ok: false, reason: 'no_app_account_token' };
  const subscriber = findSubscriber(db, app.project_id, tx.appAccountToken);
  if (!subscriber) return { ok: false, reason: 'unknown_subscriber' };
  if (!tx.productId) return { ok: false, reason: 'missing_product_id' };

  const expiresIso = msToIso(tx.expiresDate) ?? null;
  const graceIso = msToIso(renewal.gracePeriodExpiresDate) ?? null;
  const now = nowIso();

  let patch: SubscriptionFieldUpdate;
  let event: EventType | null;
  switch (payload.notificationType) {
    case 'SUBSCRIBED':
    case 'DID_RENEW':
      patch = { expiresDate: expiresIso, willRenew: true, billingIssuesDetectedAt: null, unsubscribeDetectedAt: null };
      event = payload.notificationType === 'SUBSCRIBED' ? 'initial_purchase' : 'renewal';
      break;
    case 'DID_FAIL_TO_RENEW':
      patch = { billingIssuesDetectedAt: now, gracePeriodExpiresDate: graceIso };
      event = 'billing_issue';
      break;
    case 'EXPIRED':
    case 'GRACE_PERIOD_EXPIRED':
      patch = { willRenew: false, expiresDate: expiresIso ?? now };
      event = 'expiration';
      break;
    case 'DID_CHANGE_RENEWAL_STATUS':
      if (payload.subtype === 'AUTO_RENEW_DISABLED' || renewal.autoRenewStatus === 0) {
        patch = { unsubscribeDetectedAt: now, willRenew: false };
        event = 'cancellation';
      } else {
        patch = { unsubscribeDetectedAt: null, willRenew: true };
        event = null;
      }
      break;
    case 'REFUND':
    case 'REVOKE':
      patch = { expiresDate: now, willRenew: false };
      event = 'cancellation';
      break;
    default:
      return { ok: true, handled: `ignored:${payload.notificationType}` };
  }

  applyToSubscription(db, app.project_id, subscriber.id, tx.productId, patch, expiresIso);
  if (event) {
    emitEvent(db, {
      projectId: app.project_id,
      type: event,
      subscriberId: subscriber.id,
      appUserId: subscriber.original_app_user_id,
      productStoreIdentifier: tx.productId,
      store: 'app_store',
      expiresDate: expiresIso,
    });
  }
  return { ok: true, handled: payload.notificationType };
}

// ----------------------------------------------------------------------------
// Google — Real-time Developer Notifications (Pub/Sub push)
// ----------------------------------------------------------------------------

interface GooglePubSubEnvelope {
  message?: { data?: string };
}
interface GoogleRtdnData {
  packageName?: string;
  subscriptionNotification?: { notificationType?: number; purchaseToken?: string; subscriptionId?: string };
  voidedPurchaseNotification?: { purchaseToken?: string };
  testNotification?: { version?: string };
}

// Google subscription notification types.
const G = {
  RECOVERED: 1,
  RENEWED: 2,
  CANCELED: 3,
  PURCHASED: 4,
  ON_HOLD: 5,
  IN_GRACE_PERIOD: 6,
  RESTARTED: 7,
  REVOKED: 12,
  EXPIRED: 13,
} as const;

export function processGoogleNotification(db: DB, _config: Config, envelope: GooglePubSubEnvelope): NotificationResult {
  const raw = envelope.message?.data;
  if (!raw) return { ok: false, reason: 'missing_message_data' };
  let data: GoogleRtdnData;
  try {
    data = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
  } catch {
    return { ok: false, reason: 'invalid_message_data' };
  }
  if (data.testNotification) return { ok: true, handled: 'TEST' };
  if (!data.packageName) return { ok: false, reason: 'missing_package_name' };
  const app = getAppByPackageName(db, data.packageName);
  if (!app) return { ok: false, reason: 'unknown_package_name' };

  const token =
    data.subscriptionNotification?.purchaseToken ?? data.voidedPurchaseNotification?.purchaseToken;
  if (!token) return { ok: false, reason: 'missing_purchase_token' };

  // The Android purchase token is stored as the receipt's fetch_token.
  const receipt = findReceipt(db, 'play_store', token);
  if (!receipt || receipt.project_id !== app.project_id) return { ok: false, reason: 'unknown_purchase_token' };

  const now = nowIso();
  let patch: SubscriptionFieldUpdate;
  let event: EventType | null;

  if (data.voidedPurchaseNotification) {
    patch = { expiresDate: now, willRenew: false };
    event = 'cancellation';
  } else {
    switch (data.subscriptionNotification?.notificationType) {
      case G.RENEWED:
      case G.RECOVERED:
      case G.PURCHASED:
      case G.RESTARTED:
        patch = { willRenew: true, billingIssuesDetectedAt: null, unsubscribeDetectedAt: null };
        event = 'renewal';
        break;
      case G.CANCELED:
        patch = { unsubscribeDetectedAt: now, willRenew: false };
        event = 'cancellation';
        break;
      case G.ON_HOLD:
      case G.IN_GRACE_PERIOD:
        patch = { billingIssuesDetectedAt: now };
        event = 'billing_issue';
        break;
      case G.EXPIRED:
      case G.REVOKED:
        patch = { expiresDate: now, willRenew: false };
        event = 'expiration';
        break;
      default:
        return { ok: true, handled: `ignored:${data.subscriptionNotification?.notificationType}` };
    }
  }

  updateSubscriptionFields(db, receipt.subscriber_id, receipt.product_store_identifier, patch);
  if (event) {
    const sub = findSubscriberById(db, receipt.subscriber_id);
    emitEvent(db, {
      projectId: app.project_id,
      type: event,
      subscriberId: receipt.subscriber_id,
      appUserId: sub?.original_app_user_id ?? null,
      productStoreIdentifier: receipt.product_store_identifier,
      store: 'play_store',
    });
  }
  return { ok: true, handled: String(data.subscriptionNotification?.notificationType ?? 'voided') };
}

// --- helpers ---

function applyToSubscription(
  db: DB,
  projectId: string,
  subscriberId: string,
  productStoreIdentifier: string,
  patch: SubscriptionFieldUpdate,
  expiresIso: string | null,
): void {
  const updated = updateSubscriptionFields(db, subscriberId, productStoreIdentifier, patch);
  if (!updated) {
    // No prior subscription (e.g. a renewal arrived before any client receipt) — create it.
    upsertSubscription(db, {
      projectId,
      subscriberId,
      productStoreIdentifier,
      store: 'app_store',
      purchaseDate: nowIso(),
      expiresDate: patch.expiresDate ?? expiresIso,
      willRenew: patch.willRenew !== false,
    });
  }
}

function findSubscriberById(db: DB, id: string): { original_app_user_id: string } | undefined {
  return db.prepare('SELECT original_app_user_id FROM subscribers WHERE id = ?').get(id) as
    | { original_app_user_id: string }
    | undefined;
}
