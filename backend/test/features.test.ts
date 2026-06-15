import { createServer, type Server } from 'node:http';
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
async function pub(method: 'POST' | 'GET', url: string, body?: unknown) {
  return app.inject({
    method,
    url,
    headers: {
      authorization: `Bearer ${pk}`,
      'x-platform': 'ios',
      'x-sdk-version': '0.1.0',
      'x-app-version': '1.2.3',
    },
    payload: body as object,
  });
}

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
  await admin('POST', '/v1/admin/entitlements', { identifier: 'pro', display_name: 'Pro', product_ids: [monthly.id] });
}

beforeEach(async () => {
  db = openDb(':memory:');
  sk = ensureRootSecretKey(db);
  app = buildApp({ db, config: loadConfig({ DATABASE_PATH: ':memory:' } as NodeJS.ProcessEnv) });
  await app.ready();
  pk = (await admin('POST', '/v1/admin/apps', { name: 'Test' })).json().public_api_key;
});

afterEach(async () => {
  await app.close();
  db.close();
});

describe('SDK diagnostics', () => {
  it('tracks SDK connection after a public request', async () => {
    await pub('GET', '/v1/subscribers/diag-user');
    const diag = (await admin('GET', '/v1/admin/diagnostics')).json();
    expect(diag.backend_version).toBe('0.1.0');
    expect(diag.apps[0].connected).toBe(true);
    expect(diag.apps[0].platforms[0].platform).toBe('ios');
    expect(diag.apps[0].platforms[0].sdk_version).toBe('0.1.0');
  });
});

describe('events feed', () => {
  it('records an initial_purchase event on receipt', async () => {
    await setupCatalog();
    await pub('POST', '/v1/receipts', {
      app_user_id: 'evt-user',
      fetch_token: 'tok-evt',
      product_id: 'com.app.pro.monthly',
      store: 'app_store',
      price: 9.99,
      currency: 'USD',
    });
    const events = (await admin('GET', '/v1/admin/events')).json();
    expect(events.items[0].type).toBe('initial_purchase');
    expect(events.items[0].app_user_id).toBe('evt-user');
  });
});

describe('product import', () => {
  it('bulk-imports products and skips duplicates', async () => {
    const products = [
      { store_identifier: 'com.a.monthly', type: 'subscription', store: 'app_store', display_name: 'A', duration: 'P1M' },
      { store_identifier: 'com.a.monthly', type: 'subscription', store: 'app_store', display_name: 'A dup', duration: 'P1M' },
      { store_identifier: 'com.a.annual', type: 'subscription', store: 'play_store', display_name: 'B', duration: 'P1Y' },
    ];
    const res = (await admin('POST', '/v1/admin/products/import', { products })).json();
    expect(res.imported).toBe(2);
    expect(res.skipped).toBe(1);
    expect(res.failed).toHaveLength(0);
  });
});

describe('insights', () => {
  it('computes funnel and LTV', async () => {
    await setupCatalog();
    await pub('POST', '/v1/receipts', {
      app_user_id: 'ins-user',
      fetch_token: 'tok-ins',
      product_id: 'com.app.pro.monthly',
      store: 'app_store',
      price: 9.99,
      currency: 'USD',
    });
    const insights = (await admin('GET', '/v1/admin/insights')).json();
    expect(insights.funnel.find((s: { stage: string }) => s.stage === 'Customers').count).toBe(1);
    expect(insights.ltv.paying_customers).toBe(1);
    expect(insights.ltv.total_revenue).toBeCloseTo(9.99);
  });
});

describe('webhooks', () => {
  it('delivers a signed event to a registered endpoint', async () => {
    await setupCatalog();
    const received: { body: string; signature: string | undefined }[] = [];
    const server: Server = createServer((req, res) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        received.push({ body: data, signature: req.headers['x-revenuedog-signature'] as string | undefined });
        res.statusCode = 200;
        res.end('ok');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as { port: number }).port;

    await admin('POST', '/v1/admin/webhooks', { url: `http://127.0.0.1:${port}/hook` });

    await pub('POST', '/v1/receipts', {
      app_user_id: 'wh-user',
      fetch_token: 'tok-wh',
      product_id: 'com.app.pro.monthly',
      store: 'app_store',
      price: 9.99,
      currency: 'USD',
    });

    // Delivery is fire-and-forget; poll briefly.
    for (let i = 0; i < 50 && received.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    server.close();

    expect(received.length).toBeGreaterThan(0);
    const payload = JSON.parse(received[0]!.body);
    expect(payload.event.type).toBe('initial_purchase');
    expect(received[0]!.signature).toMatch(/^[a-f0-9]{64}$/);
  });

  it('lists webhooks and CRUD works', async () => {
    const created = (await admin('POST', '/v1/admin/webhooks', { url: 'https://example.com/hook', events: ['renewal'] })).json();
    expect(created.secret).toMatch(/^whsec_/);
    const list = (await admin('GET', '/v1/admin/webhooks')).json();
    expect(list.items).toHaveLength(1);
    await admin('DELETE', `/v1/admin/webhooks/${created.id}`);
    expect((await admin('GET', '/v1/admin/webhooks')).json().items).toHaveLength(0);
  });
});

describe('api docs', () => {
  it('serves the Redoc docs page', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });
});

describe('multi-tenancy isolation', () => {
  // Two projects on one backend must never see each other's data. This test IS the
  // security guarantee for the hosted (multi-tenant) deployment.
  it('scopes apps, catalog, and subscribers per project', async () => {
    // Project A = the default project (root sk_ + its app `pk`).
    await setupCatalog(); // product com.app.pro.monthly + entitlement `pro` in project A
    await pub('POST', '/v1/receipts', {
      app_user_id: 'shared-id',
      fetch_token: 'tok-A',
      product_id: 'com.app.pro.monthly',
      store: 'app_store',
    });

    // Project B = a second project with its own secret key, created directly in the DB.
    const { createOrganization, createProject } = await import('../src/repo/projects.js');
    const { createSecretKey } = await import('../src/repo/accounts.js');
    const org = createOrganization(db, 'Org B');
    const projB = createProject(db, org.id, 'Project B');
    const skB = createSecretKey(db, projB.id).plaintext;
    const adminB = (method: 'POST' | 'GET', url: string, payload?: unknown) =>
      app.inject({ method, url, headers: { authorization: `Bearer ${skB}` }, payload: payload as object });

    // B sees none of A's catalog or subscribers.
    expect((await adminB('GET', '/v1/admin/products')).json().items).toHaveLength(0);
    expect((await adminB('GET', '/v1/admin/apps')).json().items).toHaveLength(0);
    expect((await adminB('GET', '/v1/admin/subscribers')).json().items).toHaveLength(0);

    // B can create its own app with the SAME product id — no collision with A.
    const pkB = (await adminB('POST', '/v1/admin/apps', { name: 'App B' })).json().public_api_key;
    await adminB('POST', '/v1/admin/products', {
      store_identifier: 'com.app.pro.monthly',
      type: 'subscription',
      store: 'app_store',
      display_name: 'B Pro',
      duration: 'P1M',
    });

    // The SAME app_user_id in B is a distinct subscriber with no entitlements from A.
    const infoB = await app.inject({
      method: 'GET',
      url: '/v1/subscribers/shared-id',
      headers: { authorization: `Bearer ${pkB}`, 'x-platform': 'ios' },
    });
    expect(Object.keys(infoB.json().subscriber.entitlements)).not.toContain('pro');

    // A still has exactly its own data.
    expect((await admin('GET', '/v1/admin/products')).json().items).toHaveLength(1);
    expect((await admin('GET', '/v1/admin/subscribers')).json().items).toHaveLength(1);
  });
});

describe('RevenueCat compatibility', () => {
  // Locks the CustomerInfo response to RevenueCat's documented schema so the
  // official RevenueCat SDK can decode it unchanged (drop-in via Purchases.proxyURL).
  it('issues RevenueCat-style platform keys that authenticate public endpoints', async () => {
    const created = (await admin('POST', '/v1/admin/apps', { name: 'RC App' })).json();
    expect(created.apple_api_key).toMatch(/^appl_/);
    expect(created.google_api_key).toMatch(/^goog_/);

    // The RevenueCat SDK would send the appl_ key on iOS — it must authenticate.
    const res = await app.inject({
      method: 'GET',
      url: '/v1/subscribers/rc-keyed-user',
      headers: { authorization: `Bearer ${created.apple_api_key}`, 'x-platform': 'ios' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().subscriber.original_app_user_id).toBe('rc-keyed-user');
  });

  it('accepts a receipt without a "store" field, inferring it from X-Platform (RC SDK behaviour)', async () => {
    await setupCatalog();
    // RevenueCat's SDK posts no `store`; X-Platform: ios → app_store.
    const res = await pub('POST', '/v1/receipts', {
      app_user_id: 'rc-nostore',
      fetch_token: 'tok-nostore',
      product_id: 'com.app.pro.monthly',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().subscriber.subscriptions['com.app.pro.monthly'].store).toBe('app_store');
  });

  it('returns offerings packages with platform_product_identifier (+ plan id) for the SDK', async () => {
    await setupCatalog();
    const monthly = (await admin('GET', '/v1/admin/products')).json().items[0];
    await admin('POST', '/v1/admin/offerings', {
      identifier: 'default',
      is_current: true,
      packages: [{ identifier: '$rc_monthly', product_ids: [monthly.id] }],
    });
    const offerings = (await pub('GET', '/v1/subscribers/off-user/offerings')).json();
    expect(offerings.current_offering_id).toBe('default');
    const pkg = offerings.offerings[0].packages[0];
    expect(pkg.identifier).toBe('$rc_monthly');
    expect(pkg.platform_product_identifier).toBe('com.app.pro.monthly');
    expect(pkg).toHaveProperty('platform_product_plan_identifier');
  });

  it('returns a RevenueCat-shaped CustomerInfo with all required fields', async () => {
    await setupCatalog();
    await pub('POST', '/v1/receipts', {
      app_user_id: 'rc-user',
      fetch_token: 'tok-rc',
      product_id: 'com.app.pro.monthly',
      store: 'app_store',
      price: 9.99,
      currency: 'USD',
    });
    const info = (await pub('GET', '/v1/subscribers/rc-user')).json();

    // Top level
    expect(typeof info.request_date).toBe('string');
    expect(typeof info.request_date_ms).toBe('number');

    const s = info.subscriber;
    for (const k of [
      'original_app_user_id',
      'original_application_version',
      'original_purchase_date',
      'first_seen',
      'last_seen',
      'management_url',
      'entitlements',
      'subscriptions',
      'non_subscriptions',
      'other_purchases',
      'subscriber_attributes',
    ]) {
      expect(s, `subscriber.${k} present`).toHaveProperty(k);
    }

    // Subscription object shape
    const sub = s.subscriptions['com.app.pro.monthly'];
    expect(sub).toBeDefined();
    for (const k of [
      'purchase_date',
      'original_purchase_date',
      'expires_date',
      'store',
      'unsubscribe_detected_at',
      'billing_issues_detected_at',
      'grace_period_expires_date',
      'is_sandbox',
      'ownership_type',
      'period_type',
      'refunded_at',
      'auto_resume_date',
      'store_transaction_id',
      'product_plan_identifier',
      'price',
      'will_renew',
    ]) {
      expect(sub, `subscription.${k} present`).toHaveProperty(k);
    }
    expect(sub.ownership_type).toBe('PURCHASED');
    expect(sub.price).toEqual({ amount: 9.99, currency: 'USD' });
    expect(sub.store).toBe('app_store');

    // Entitlement object shape
    const ent = s.entitlements.pro;
    expect(ent).toBeDefined();
    for (const k of ['expires_date', 'purchase_date', 'product_identifier', 'grace_period_expires_date']) {
      expect(ent, `entitlement.${k} present`).toHaveProperty(k);
    }
  });
});

describe('receipt ownership', () => {
  it('re-submitting the same token by its owner is an idempotent no-op', async () => {
    await setupCatalog();
    const body = {
      app_user_id: 'owner-user',
      fetch_token: 'tok-shared',
      product_id: 'com.app.pro.monthly',
      store: 'app_store',
    };
    const first = await pub('POST', '/v1/receipts', body);
    expect(first.statusCode).toBe(200);
    const second = await pub('POST', '/v1/receipts', body);
    expect(second.statusCode).toBe(200);
    expect(Object.keys(second.json().subscriber.entitlements)).toContain('pro');
  });

  it('rejects a token already registered to another user (no purchase hijack)', async () => {
    await setupCatalog();
    await pub('POST', '/v1/receipts', {
      app_user_id: 'owner-user',
      fetch_token: 'tok-stolen',
      product_id: 'com.app.pro.monthly',
      store: 'app_store',
    });
    const attacker = await pub('POST', '/v1/receipts', {
      app_user_id: 'attacker-user',
      fetch_token: 'tok-stolen',
      product_id: 'com.app.pro.monthly',
      store: 'app_store',
    });
    expect(attacker.statusCode).toBe(409);
    expect(attacker.json().error.code).toBe('conflict');
    // Attacker gained nothing.
    const attackerInfo = (await pub('GET', '/v1/subscribers/attacker-user')).json();
    expect(Object.keys(attackerInfo.subscriber.entitlements)).not.toContain('pro');
  });
});
