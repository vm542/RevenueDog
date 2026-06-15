import type { DB } from '../db.js';
import { addDuration } from '../duration.js';
import { receiptValidationFailed } from '../errors.js';
import { nowIso } from '../ids.js';
import { getProductByStoreId, getProductByStoreIdAny, type ProductStore } from '../repo/products.js';
import { findReceipt, recordReceipt } from '../repo/receipts.js';
import {
  findSubscriber,
  getOrCreateSubscriber,
  insertNonSubscription,
  upsertSubscription,
  type SubStore,
} from '../repo/subscribers.js';
import { buildCustomerInfo, type CustomerInfo } from './customerInfo.js';
import type { Validators } from './validators.js';

export interface ProcessReceiptInput {
  appUserId: string;
  fetchToken: string;
  productId: string; // store identifier (e.g. com.app.pro.monthly)
  store: 'app_store' | 'play_store';
  presentedOfferingIdentifier?: string | null;
  price?: number | null;
  currency?: string | null;
}

export async function processReceipt(
  db: DB,
  validators: Validators,
  input: ProcessReceiptInput,
): Promise<CustomerInfo> {
  const { subscriber } = getOrCreateSubscriber(db, input.appUserId);

  // Idempotency: a previously processed (store, token) just returns current state.
  const dup = findReceipt(db, input.store, input.fetchToken);
  if (dup) return buildCustomerInfo(db, subscriber);

  const productStore: ProductStore = input.store;
  const product =
    getProductByStoreId(db, input.productId, productStore) ?? getProductByStoreIdAny(db, input.productId);
  if (!product) {
    throw receiptValidationFailed(
      `Unknown product "${input.productId}". Configure it in the dashboard before submitting receipts.`,
    );
  }

  const validation = await validators[input.store].validate({
    store: input.store,
    fetchToken: input.fetchToken,
    productStoreIdentifier: input.productId,
  });
  const purchaseDate = validation.purchaseDate ?? nowIso();

  if (product.type === 'subscription') {
    let expiresDate: string | null;
    if (validation.expiresDate !== undefined) expiresDate = validation.expiresDate;
    else expiresDate = product.duration ? addDuration(purchaseDate, product.duration) : null;
    upsertSubscription(db, {
      subscriberId: subscriber.id,
      productStoreIdentifier: input.productId,
      store: input.store as SubStore,
      purchaseDate,
      expiresDate,
      periodType: validation.periodType ?? 'normal',
      isSandbox: validation.isSandbox,
      willRenew: true,
    });
  } else {
    insertNonSubscription(db, {
      subscriberId: subscriber.id,
      productStoreIdentifier: input.productId,
      store: input.store as SubStore,
      purchaseDate,
      isSandbox: validation.isSandbox,
    });
  }

  recordReceipt(db, {
    store: input.store,
    fetchToken: input.fetchToken,
    subscriberId: subscriber.id,
    productId: product.id,
    productStoreIdentifier: input.productId,
    presentedOfferingIdentifier: input.presentedOfferingIdentifier ?? null,
    price: input.price ?? null,
    currency: input.currency ?? null,
  });

  const fresh = findSubscriber(db, input.appUserId) ?? subscriber;
  return buildCustomerInfo(db, fresh);
}
