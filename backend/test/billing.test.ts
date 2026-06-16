import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDb, type DB } from '../src/db.js';

let app: FastifyInstance;
let db: DB;

beforeEach(async () => {
  db = openDb(':memory:');
  app = buildApp({ db, config: loadConfig({ DATABASE_PATH: ':memory:' } as NodeJS.ProcessEnv) });
  await app.ready();
});
afterEach(async () => {
  await app.close();
  db.close();
});

function signup() {
  return app
    .inject({ method: 'POST', url: '/v1/auth/signup', payload: { email: 'b@example.com', password: 'hunter2pass' } })
    .then((r) => r.json());
}
function get(url: string, token: string) {
  return app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
}
function webhook(event: unknown) {
  return app.inject({ method: 'POST', url: '/v1/billing/webhook', payload: event as object });
}

describe('billing', () => {
  it('reports the free plan, usage, and limits for a new org', async () => {
    const { token } = await signup();
    const billing = (await get('/v1/billing', token)).json();
    expect(billing.plan.id).toBe('free');
    expect(billing.plan.max_subscribers).toBe(1000);
    expect(billing.billing_status).toBe('active');
    expect(billing.usage).toEqual({ subscribers: 0, events_30d: 0 });
    expect(billing.over_limit).toBe(false);
  });

  it('counts tracked subscribers toward usage', async () => {
    const account = await signup();
    // Create an app + product in the org's project, then register a subscriber via a receipt.
    const pk = (
      await app.inject({
        method: 'POST',
        url: '/v1/admin/apps',
        headers: { authorization: `Bearer ${account.secret_key}` },
        payload: { name: 'A' },
      })
    ).json().public_api_key;
    await app.inject({
      method: 'POST',
      url: '/v1/admin/products',
      headers: { authorization: `Bearer ${account.secret_key}` },
      payload: { store_identifier: 'com.x.m', type: 'subscription', store: 'app_store', display_name: 'M', duration: 'P1M' },
    });
    await app.inject({
      method: 'POST',
      url: '/v1/receipts',
      headers: { authorization: `Bearer ${pk}`, 'x-platform': 'ios' },
      payload: { app_user_id: 'u1', fetch_token: 't1', product_id: 'com.x.m' },
    });

    const billing = (await get('/v1/billing', account.token)).json();
    expect(billing.usage.subscribers).toBe(1);
    expect(billing.usage.events_30d).toBeGreaterThanOrEqual(1);
  });

  it('upgrades the plan from a Stripe subscription webhook', async () => {
    const account = await signup();

    // Stripe checkout completes → links customer + sets plan.
    const done = await webhook({
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: account.user.org_id,
          customer: 'cus_123',
          subscription: 'sub_123',
          metadata: { org_id: account.user.org_id, plan: 'pro' },
        },
      },
    });
    expect(done.json()).toMatchObject({ ok: true, handled: 'checkout.session.completed' });
    expect((await get('/v1/billing', account.token)).json().plan.id).toBe('pro');

    // Subscription canceled → back to free.
    await webhook({
      type: 'customer.subscription.deleted',
      data: { object: { customer: 'cus_123' } },
    });
    const after = (await get('/v1/billing', account.token)).json();
    expect(after.plan.id).toBe('free');
    expect(after.billing_status).toBe('canceled');
  });

  it('exposes billing to the dashboard via the project secret key (admin endpoint)', async () => {
    const account = await signup();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/billing',
      headers: { authorization: `Bearer ${account.secret_key}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.plan.id).toBe('free');
    expect(body.usage).toHaveProperty('subscribers');
    expect(body.over_limit).toBe(false);
  });

  it('checkout fails clearly when Stripe is not configured', async () => {
    const { token } = await signup();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/billing/checkout',
      headers: { authorization: `Bearer ${token}` },
      payload: { plan: 'pro', success_url: 'https://x.com/ok', cancel_url: 'https://x.com/no' },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('store_problem');
  });
});
