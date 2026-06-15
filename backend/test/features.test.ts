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
