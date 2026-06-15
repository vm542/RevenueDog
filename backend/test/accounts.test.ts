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

function post(url: string, payload: unknown, token?: string) {
  return app.inject({
    method: 'POST',
    url,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    payload: payload as object,
  });
}
function get(url: string, token: string) {
  return app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
}

describe('hosted accounts', () => {
  it('signs up, returns a session + project + secret key', async () => {
    const res = await post('/v1/auth/signup', { email: 'Erin@Example.com', password: 'hunter2pass' });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.token).toMatch(/^sess_/);
    expect(body.user.email).toBe('erin@example.com');
    expect(body.secret_key).toMatch(/^sk_/);
    expect(body.project.name).toBe('Default');
  });

  it('rejects duplicate email and weak passwords', async () => {
    await post('/v1/auth/signup', { email: 'dup@example.com', password: 'longenough1' });
    expect((await post('/v1/auth/signup', { email: 'dup@example.com', password: 'longenough1' })).statusCode).toBe(409);
    expect((await post('/v1/auth/signup', { email: 'x@example.com', password: 'short' })).statusCode).toBe(400);
  });

  it('logs in and resolves the session via /auth/me', async () => {
    await post('/v1/auth/signup', { email: 'me@example.com', password: 'hunter2pass' });
    const login = await post('/v1/auth/login', { email: 'me@example.com', password: 'hunter2pass' });
    expect(login.statusCode).toBe(200);
    const token = login.json().token;
    const me = await get('/v1/auth/me', token);
    expect(me.json().user.email).toBe('me@example.com');
    expect(me.json().projects).toHaveLength(1);
  });

  it('rejects bad credentials and unauthenticated access', async () => {
    await post('/v1/auth/signup', { email: 'sec@example.com', password: 'hunter2pass' });
    expect((await post('/v1/auth/login', { email: 'sec@example.com', password: 'wrong' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/v1/auth/me' })).statusCode).toBe(401);
  });

  it('manages API keys: create, list masked, and the new key actually works on admin', async () => {
    const signup = (await post('/v1/auth/signup', { email: 'keys@example.com', password: 'hunter2pass' })).json();
    const token = signup.token;
    const projectId = signup.project.id;

    // List shows the signup key by prefix only (no plaintext at rest).
    const keys = (await get(`/v1/projects/${projectId}/keys`, token)).json();
    expect(keys.items).toHaveLength(1);
    expect(keys.items[0].key_prefix).toMatch(/^sk_/);
    expect(keys.items[0]).not.toHaveProperty('secret_key');

    // Create a second key; the full value is returned once.
    const created = (await post(`/v1/projects/${projectId}/keys`, {}, token)).json();
    expect(created.secret_key).toMatch(/^sk_/);
    expect(created.id).toMatch(/^key_/);
    expect((await get(`/v1/projects/${projectId}/keys`, token)).json().items).toHaveLength(2);

    // The new secret key authenticates the admin API, scoped to this project.
    const products = await app.inject({
      method: 'GET',
      url: '/v1/admin/products',
      headers: { authorization: `Bearer ${created.secret_key}` },
    });
    expect(products.statusCode).toBe(200);
    expect(products.json().items).toEqual([]);
  });

  it("a second account cannot see another org's project keys", async () => {
    const a = (await post('/v1/auth/signup', { email: 'a@example.com', password: 'hunter2pass' })).json();
    const b = (await post('/v1/auth/signup', { email: 'b@example.com', password: 'hunter2pass' })).json();
    // B tries to read A's project keys.
    const res = await get(`/v1/projects/${a.project.id}/keys`, b.token);
    expect(res.statusCode).toBe(404);
  });

  it('records an audit trail for signup and key creation', async () => {
    const signup = (await post('/v1/auth/signup', { email: 'audit@example.com', password: 'hunter2pass' })).json();
    await post(`/v1/projects/${signup.project.id}/keys`, {}, signup.token);
    // The project's secret key reads the admin audit log.
    const audit = await app.inject({
      method: 'GET',
      url: '/v1/admin/audit',
      headers: { authorization: `Bearer ${signup.secret_key}` },
    });
    const actions = audit.json().items.map((e: { action: string }) => e.action);
    expect(actions).toContain('auth.signup');
    expect(actions).toContain('key.create');
  });
});

describe('rate limiting', () => {
  it('returns 429 once the per-minute limit is exceeded', async () => {
    const limited = buildApp({
      db,
      config: loadConfig({ DATABASE_PATH: ':memory:', RATE_LIMIT_PER_MIN: '3' } as NodeJS.ProcessEnv),
    });
    await limited.ready();
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) {
      codes.push((await limited.inject({ method: 'GET', url: '/v1/admin/products' })).statusCode);
    }
    // /health is exempt; an admin route without a key returns 401 until rate-limited (429).
    expect(codes.slice(0, 3)).toEqual([401, 401, 401]);
    expect(codes).toContain(429);
    await limited.close();
  });
});
