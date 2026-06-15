import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { ensureRootSecretKey } from '../src/auth.js';
import { loadConfig } from '../src/config.js';
import { openDb, type DB } from '../src/db.js';

let app: FastifyInstance;
let db: DB;
let sk: string;
let pk: string;

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jws = (payload: unknown) => `${b64url({ alg: 'ES256' })}.${b64url(payload)}.sig`;

async function admin(method: 'POST' | 'GET', url: string, body?: unknown) {
  return app.inject({ method, url, headers: { authorization: `Bearer ${sk}` }, payload: body as object });
}
function receipt(store: 'app_store' | 'play_store', payload: object) {
  return app.inject({
    method: 'POST',
    url: '/v1/receipts',
    headers: { authorization: `Bearer ${pk}`, 'x-platform': store === 'app_store' ? 'ios' : 'android' },
    payload,
  });
}
function customer(appUserId: string) {
  return admin('GET', `/v1/admin/subscribers/${appUserId}`).then((r) => r.json());
}
function events() {
  return admin('GET', '/v1/admin/events').then((r) => r.json().items as { type: string }[]);
}

beforeEach(async () => {
  db = openDb(':memory:');
  sk = ensureRootSecretKey(db);
  app = buildApp({ db, config: loadConfig({ DATABASE_PATH: ':memory:' } as NodeJS.ProcessEnv) });
  await app.ready();
  pk = (
    await admin('POST', '/v1/admin/apps', { name: 'N', bundle_id: 'com.test.app', package_name: 'com.test.app' })
  ).json().public_api_key;
  const product = (
    await admin('POST', '/v1/admin/products', {
      store_identifier: 'com.app.pro.monthly',
      type: 'subscription',
      store: 'app_store',
      display_name: 'Pro',
      duration: 'P1M',
    })
  ).json();
  await admin('POST', '/v1/admin/products', {
    store_identifier: 'com.app.pro.monthly',
    type: 'subscription',
    store: 'play_store',
    display_name: 'Pro',
    duration: 'P1M',
  });
  await admin('POST', '/v1/admin/entitlements', { identifier: 'pro', display_name: 'Pro', product_ids: [product.id] });
});

afterEach(async () => {
  await app.close();
  db.close();
});

function appleNotification(notificationType: string, subtype: string | undefined, tx: object, renewal: object = {}) {
  return {
    signedPayload: jws({
      notificationType,
      subtype,
      data: {
        bundleId: 'com.test.app',
        environment: 'Production',
        signedTransactionInfo: jws(tx),
        signedRenewalInfo: jws(renewal),
      },
    }),
  };
}

describe('Apple App Store Server Notifications V2', () => {
  it('renews then cancels a subscription, driven entirely by notifications', async () => {
    await receipt('app_store', {
      app_user_id: 'a-user',
      fetch_token: 'tok-a',
      product_id: 'com.app.pro.monthly',
    });

    const future = Date.now() + 60 * 24 * 3600 * 1000;
    const renew = await app.inject({
      method: 'POST',
      url: '/v1/notifications/apple',
      payload: appleNotification('DID_RENEW', undefined, {
        productId: 'com.app.pro.monthly',
        appAccountToken: 'a-user',
        expiresDate: future,
      }),
    });
    expect(renew.statusCode).toBe(200);
    expect(renew.json()).toMatchObject({ ok: true, handled: 'DID_RENEW' });

    let info = await customer('a-user');
    expect(info.subscriber.subscriptions['com.app.pro.monthly'].will_renew).toBe(true);
    expect((await events()).map((e) => e.type)).toContain('renewal');

    // User turns off auto-renew.
    await app.inject({
      method: 'POST',
      url: '/v1/notifications/apple',
      payload: appleNotification('DID_CHANGE_RENEWAL_STATUS', 'AUTO_RENEW_DISABLED', {
        productId: 'com.app.pro.monthly',
        appAccountToken: 'a-user',
        expiresDate: future,
      }),
    });
    info = await customer('a-user');
    expect(info.subscriber.subscriptions['com.app.pro.monthly'].will_renew).toBe(false);
    expect(info.subscriber.subscriptions['com.app.pro.monthly'].unsubscribe_detected_at).not.toBeNull();
    expect((await events()).map((e) => e.type)).toContain('cancellation');
  });

  it('acks unmappable notifications without acting', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/notifications/apple',
      payload: appleNotification('DID_RENEW', undefined, {
        productId: 'com.app.pro.monthly',
        appAccountToken: 'ghost-user',
        expiresDate: Date.now(),
      }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: false, reason: 'unknown_subscriber' });
  });

  it('acks Apple TEST notifications', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/notifications/apple',
      payload: { signedPayload: jws({ notificationType: 'TEST' }) },
    });
    expect(res.json()).toMatchObject({ ok: true, handled: 'TEST' });
  });
});

describe('Google Real-time Developer Notifications', () => {
  function rtdn(notificationType: number, purchaseToken: string) {
    const data = Buffer.from(
      JSON.stringify({
        packageName: 'com.test.app',
        subscriptionNotification: { notificationType, purchaseToken, subscriptionId: 'com.app.pro.monthly' },
      }),
    ).toString('base64');
    return { message: { data } };
  }

  it('cancels a subscription on a CANCELED notification', async () => {
    await receipt('play_store', {
      app_user_id: 'g-user',
      fetch_token: 'gtok',
      product_id: 'com.app.pro.monthly',
    });

    const res = await app.inject({ method: 'POST', url: '/v1/notifications/google', payload: rtdn(3, 'gtok') });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);

    const info = await customer('g-user');
    expect(info.subscriber.subscriptions['com.app.pro.monthly'].unsubscribe_detected_at).not.toBeNull();
    expect((await events()).map((e) => e.type)).toContain('cancellation');
  });

  it('rejects an unknown purchase token', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/notifications/google', payload: rtdn(2, 'nope') });
    expect(res.json()).toMatchObject({ ok: false, reason: 'unknown_purchase_token' });
  });
});
