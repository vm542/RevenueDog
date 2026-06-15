import type { DB } from '../db.js';
import { genId, nowIso } from '../ids.js';

export interface ReceiptRow {
  id: string;
  store: string;
  fetch_token: string;
  subscriber_id: string;
  product_id: string;
  product_store_identifier: string;
  presented_offering_identifier: string | null;
  price: number | null;
  currency: string | null;
  created_at: string;
}

export interface RecordReceiptInput {
  store: string;
  fetchToken: string;
  subscriberId: string;
  productId: string;
  productStoreIdentifier: string;
  presentedOfferingIdentifier?: string | null;
  price?: number | null;
  currency?: string | null;
}

export function findReceipt(db: DB, store: string, fetchToken: string): ReceiptRow | undefined {
  return db
    .prepare('SELECT * FROM receipts WHERE store = ? AND fetch_token = ?')
    .get(store, fetchToken) as ReceiptRow | undefined;
}

export function recordReceipt(db: DB, input: RecordReceiptInput): ReceiptRow {
  const row: ReceiptRow = {
    id: genId('rcpt'),
    store: input.store,
    fetch_token: input.fetchToken,
    subscriber_id: input.subscriberId,
    product_id: input.productId,
    product_store_identifier: input.productStoreIdentifier,
    presented_offering_identifier: input.presentedOfferingIdentifier ?? null,
    price: input.price ?? null,
    currency: input.currency ?? null,
    created_at: nowIso(),
  };
  db.prepare(
    `INSERT INTO receipts (id, store, fetch_token, subscriber_id, product_id, product_store_identifier,
      presented_offering_identifier, price, currency, created_at)
     VALUES (@id, @store, @fetch_token, @subscriber_id, @product_id, @product_store_identifier,
      @presented_offering_identifier, @price, @currency, @created_at)`,
  ).run(row);
  return row;
}

export function latestReceiptForProduct(
  db: DB,
  subscriberId: string,
  productStoreIdentifier: string,
): ReceiptRow | undefined {
  return db
    .prepare(
      'SELECT * FROM receipts WHERE subscriber_id = ? AND product_store_identifier = ? ORDER BY created_at DESC LIMIT 1',
    )
    .get(subscriberId, productStoreIdentifier) as ReceiptRow | undefined;
}
