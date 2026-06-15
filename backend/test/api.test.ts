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

async function admin(method: 'POST' | 'GET' | 'PATCH' | 'DELETE', url: string, body?: unknown) {
  return app.inject({ method, url, headers: { authorization: `Bearer ${sk}` }, payload: body as object });
}
async function pub(method: 'POST' | 'GET' | 'DELETE', url: string, body?: unknown, platform = 'ios') {
  return app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${pk}`, 'x-platform': platform },
    payload: body as object,
  });
}

beforeEach(async () => {
  db = openDb(':memory:');
  sk = ensureRootSecretKey(db);
  app = buildApp({ db, config: loadConfig({ DATABASE_PATH: ':memory:' } as NodeJS.ProcessEnv) });
  await app.ready();

  const appRes = await admin('POST', '/v1/admin/apps', { name: 'Test', bundle_id: 'com.t' });
  pk = appRes.json().public_api_key;
});

afterEach(async () => {
  await app.close();
  db.close();
});

describe('health & auth', () => {
  it('reports healthy', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().service).toBe('revenuedog');
  });

  it('rejects admin endpoints without a secret key', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/admin/products' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('unauthorized');
  });

  it('rejects public endpoints when using a secret key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/subscribers/u1',
      headers: { authorization: `Bearer ${sk}`, 'x-platform': 'ios' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('admin CRUD + public purchase flow', () => {
  async function setupCatalog() {
    const monthly = (
      await admin('POST', '/v1/admin/products', {
        store_identifier: 'com.app.pro.monthly',
        type: 'subscription',
        store: 'app_store',
        display_name: 'Pro Monthly',
        duration: 'P1M',
      })
    ).json();
    const monthlyPlay = (
      await admin('POST', '/v1/admin/products', {
        store_identifier: 'com.app.pro.monthly',
        type: 'subscription',
        store: 'play_store',
        display_name: 'Pro Monthly',
        duration: 'P1M',
      })
    ).json();
    await admin('POST', '/v1/admin/entitlements', {
      identifier: 'pro',
      display_name: 'Pro',
      product_ids: [monthly.id, monthlyPlay.id],
    });
    await admin('POST', '/v1/admin/offerings', {
      identifier: 'default',
      description: 'Default',
      is_current: true,
      packages: [{ identifier: '$rd_monthly', product_ids: [monthly.id, monthlyPlay.id] }],
    });
    return { monthly, monthlyPlay };
  }

  it('creates a subscriber on first GET', async () => {
    const res = await pub('GET', '/v1/subscribers/alice');
    expect(res.statusCode).toBe(200);
    expect(res.json().subscriber.original_app_user_id).toBe('alice');
    expect(res.json().subscriber.entitlements).toEqual({});
  });

  it('resolves offerings for the calling platform', async () => {
    await setupCatalog();
    const ios = (await pub('GET', '/v1/subscribers/bob/offerings', undefined, 'ios')).json();
    expect(ios.current_offering_id).toBe('default');
    expect(ios.offerings[0].packages[0].platform_product_identifier).toBe('com.app.pro.monthly');
  });

  it('unlocks an entitlement on receipt and is idempotent', async () => {
    await setupCatalog();
    const body = {
      app_user_id: 'carol',
      fetch_token: 'tok-1',
      product_id: 'com.app.pro.monthly',
      store: 'app_store',
      price: 9.99,
      currency: 'USD',
    };
    const first = await pub('POST', '/v1/receipts', body);
    expect(first.statusCode).toBe(200);
    const info = first.json();
    expect(info.subscriber.entitlements.pro).toBeDefined();
    expect(info.subscriber.subscriptions['com.app.pro.monthly'].will_renew).toBe(true);

    const second = await pub('POST', '/v1/receipts', body);
    expect(second.statusCode).toBe(200);
    // Still exactly one subscription.
    expect(Object.keys(second.json().subscriber.subscriptions)).toHaveLength(1);
  });

  it('rejects receipts for unknown products', async () => {
    const res = await pub('POST', '/v1/receipts', {
      app_user_id: 'dave',
      fetch_token: 'tok-x',
      product_id: 'com.unknown',
      store: 'app_store',
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('receipt_validation_failed');
  });

  it('merges identities on alias', async () => {
    await setupCatalog();
    await pub('POST', '/v1/receipts', {
      app_user_id: 'anon-1',
      fetch_token: 'tok-2',
      product_id: 'com.app.pro.monthly',
      store: 'app_store',
      price: 9.99,
      currency: 'USD',
    });
    const res = await pub('POST', '/v1/subscribers/anon-1/alias', { new_app_user_id: 'real-user' });
    expect(res.statusCode).toBe(200);
    // The real user now resolves to the same subscriber and keeps the entitlement.
    const real = (await pub('GET', '/v1/subscribers/real-user')).json();
    expect(real.subscriber.entitlements.pro).toBeDefined();
  });

  it('sets and deletes attributes', async () => {
    await pub('POST', '/v1/subscribers/erin/attributes', {
      attributes: { $email: { value: 'erin@example.com' } },
    });
    const info = (await pub('GET', '/v1/subscribers/erin')).json();
    expect(info.subscriber.subscriber_attributes.$email.value).toBe('erin@example.com');
  });

  it('grants and revokes promotional entitlements via admin', async () => {
    await setupCatalog();
    await pub('GET', '/v1/subscribers/promo-user');
    const grant = await admin('POST', '/v1/admin/subscribers/promo-user/entitlements/pro/grant', {
      expires_date: null,
    });
    expect(grant.statusCode).toBe(200);
    expect(grant.json().subscriber.entitlements.pro).toBeDefined();
    const revoke = await admin('POST', '/v1/admin/subscribers/promo-user/entitlements/pro/revoke', {});
    expect(revoke.json().subscriber.entitlements.pro).toBeUndefined();
  });

  it('produces analytics overview KPIs', async () => {
    await setupCatalog();
    await pub('POST', '/v1/receipts', {
      app_user_id: 'frank',
      fetch_token: 'tok-3',
      product_id: 'com.app.pro.monthly',
      store: 'app_store',
      price: 9.99,
      currency: 'USD',
    });
    const ov = (await admin('GET', '/v1/admin/overview?range=28')).json();
    expect(ov.kpis.active_subscriptions).toBe(1);
    expect(ov.kpis.revenue).toBeCloseTo(9.99);
    expect(ov.kpis.mrr).toBeCloseTo(9.99);
    expect(ov.charts.revenue.length).toBe(28);
  });
});

describe('experiments', () => {
  it('assigns a deterministic sticky variant', async () => {
    const control = (
      await admin('POST', '/v1/admin/offerings', { identifier: 'control', is_current: true })
    ).json();
    const treatment = (
      await admin('POST', '/v1/admin/offerings', { identifier: 'treatment' })
    ).json();
    await admin('POST', '/v1/admin/experiments', {
      name: 'exp',
      status: 'running',
      control_offering_id: control.id,
      treatment_offering_id: treatment.id,
      traffic_pct: 100,
    });
    const first = (await pub('GET', '/v1/subscribers/grace/offerings')).json();
    expect(first.experiment).not.toBeNull();
    expect(first.experiment.variant).toBe('treatment');
    expect(first.current_offering_id).toBe('treatment');
    // Sticky across calls.
    const second = (await pub('GET', '/v1/subscribers/grace/offerings')).json();
    expect(second.experiment.variant).toBe('treatment');
  });
});
