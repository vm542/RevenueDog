import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { DB } from '../db.js';
import { conflict, invalidRequest, notFound } from '../errors.js';
import { requireSecretKey } from '../auth.js';
import { buildDiagnostics } from '../repo/diagnostics.js';
import { isValidDuration } from '../duration.js';
import { parse } from '../validate.js';
import { createApp, deleteApp, getApp, listApps } from '../repo/apps.js';
import {
  createProduct,
  deleteProduct,
  getProduct,
  listProducts,
  updateProduct,
} from '../repo/products.js';
import {
  createEntitlement,
  deleteEntitlement,
  getEntitlement,
  listEntitlements,
  updateEntitlement,
} from '../repo/entitlements.js';
import {
  createOffering,
  deleteOffering,
  getOffering,
  listOfferings,
  updateOffering,
  type Offering,
} from '../repo/offerings.js';
import {
  createExperiment,
  deleteExperiment,
  experimentResults,
  getExperiment,
  listExperiments,
  stopExperiment,
  updateExperiment,
} from '../repo/experiments.js';
import {
  findSubscriber,
  getOrCreateSubscriber,
  listSubscribers,
  upsertSubscription,
} from '../repo/subscribers.js';
import { listEvents } from '../repo/events.js';
import {
  createWebhook,
  deleteWebhook,
  getWebhook,
  listDeliveries,
  listWebhooks,
  updateWebhook,
} from '../repo/webhooks.js';
import { buildCustomerInfo } from '../services/customerInfo.js';
import { processReceipt } from '../services/receipts.js';
import { emitEvent } from '../services/webhooks.js';
import type { Validators } from '../services/validators.js';

function serializeOffering(o: Offering) {
  return {
    id: o.id,
    identifier: o.identifier,
    description: o.description,
    metadata: o.metadata,
    is_current: o.is_current,
    packages: o.packages.map((p) => ({ identifier: p.identifier, product_ids: p.product_ids })),
  };
}

const durationField = z
  .string()
  .refine((v) => isValidDuration(v), 'must be an ISO-8601 duration like P1M')
  .nullish();

const productCreate = z.object({
  store_identifier: z.string().min(1),
  type: z.enum(['subscription', 'non_consumable', 'consumable']),
  store: z.enum(['app_store', 'play_store']),
  display_name: z.string().min(1),
  duration: durationField,
});
const productPatch = productCreate.partial();

const entitlementCreate = z.object({
  identifier: z.string().min(1),
  display_name: z.string().min(1),
  product_ids: z.array(z.string()).optional(),
});
const entitlementPatch = entitlementCreate.partial();

const packageInput = z.object({ identifier: z.string().min(1), product_ids: z.array(z.string()) });
const offeringCreate = z.object({
  identifier: z.string().min(1),
  description: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  is_current: z.boolean().optional(),
  packages: z.array(packageInput).optional(),
});
const offeringPatch = offeringCreate.partial();

const experimentCreate = z.object({
  name: z.string().min(1),
  status: z.enum(['draft', 'running', 'stopped']).optional(),
  control_offering_id: z.string().min(1),
  treatment_offering_id: z.string().min(1),
  traffic_pct: z.number().int().min(0).max(100),
});
const experimentPatch = experimentCreate.partial();

const appCreate = z.object({
  name: z.string().min(1),
  bundle_id: z.string().nullish(),
  package_name: z.string().nullish(),
});

const importsSchema = z.object({
  receipts: z.array(
    z.object({
      app_user_id: z.string().min(1),
      fetch_token: z.string().min(1),
      product_id: z.string().min(1),
      store: z.enum(['app_store', 'play_store']),
      price: z.number().nullish(),
      currency: z.string().nullish(),
    }),
  ),
});

const grantSchema = z.object({ expires_date: z.string().nullish() });

export function registerAdminRoutes(app: FastifyInstance, db: DB, validators: Validators, config: Config): void {
  app.register(async (scoped) => {
    scoped.addHook('preHandler', requireSecretKey(db));

    // --- Products ---
    scoped.post('/v1/admin/products', async (req, reply) => {
      const body = parse(productCreate, req.body);
      reply.code(201);
      return createProduct(db, req.projectId!, body);
    });
    scoped.get('/v1/admin/products', async (req) => ({ items: listProducts(db, req.projectId!) }));
    scoped.post('/v1/admin/products/import', async (req) => {
      const body = parse(z.object({ products: z.array(productCreate) }), req.body);
      let imported = 0;
      let skipped = 0;
      const failed: { index: number; error: string }[] = [];
      body.products.forEach((p, i) => {
        try {
          createProduct(db, req.projectId!, p);
          imported++;
        } catch (err) {
          if (err instanceof Error && /already exists/.test(err.message)) skipped++;
          else failed.push({ index: i, error: err instanceof Error ? err.message : String(err) });
        }
      });
      return { imported, skipped, failed };
    });
    scoped.post('/v1/admin/products/import/:store', async (req) => {
      const { store } = req.params as { store: string };
      if (store !== 'app_store' && store !== 'play_store') {
        throw invalidRequest('store must be app_store or play_store.');
      }
      const { importStoreProducts } = await import('../services/productImport.js');
      return importStoreProducts(db, req.projectId!, store, config);
    });
    scoped.get('/v1/admin/products/:id', async (req) => {
      const p = getProduct(db, req.projectId!, (req.params as { id: string }).id);
      if (!p) throw notFound('No product with that id.');
      return p;
    });
    scoped.patch('/v1/admin/products/:id', async (req) => {
      const body = parse(productPatch, req.body);
      return updateProduct(db, req.projectId!, (req.params as { id: string }).id, body);
    });
    scoped.delete('/v1/admin/products/:id', async (req) => {
      if (!deleteProduct(db, req.projectId!, (req.params as { id: string }).id))
        throw notFound('No product with that id.');
      return { ok: true };
    });

    // --- Entitlements ---
    scoped.post('/v1/admin/entitlements', async (req, reply) => {
      const body = parse(entitlementCreate, req.body);
      reply.code(201);
      return createEntitlement(db, req.projectId!, body);
    });
    scoped.get('/v1/admin/entitlements', async (req) => ({ items: listEntitlements(db, req.projectId!) }));
    scoped.get('/v1/admin/entitlements/:id', async (req) => {
      const e = getEntitlement(db, req.projectId!, (req.params as { id: string }).id);
      if (!e) throw notFound('No entitlement with that id.');
      return e;
    });
    scoped.patch('/v1/admin/entitlements/:id', async (req) => {
      const body = parse(entitlementPatch, req.body);
      return updateEntitlement(db, req.projectId!, (req.params as { id: string }).id, body);
    });
    scoped.delete('/v1/admin/entitlements/:id', async (req) => {
      if (!deleteEntitlement(db, req.projectId!, (req.params as { id: string }).id))
        throw notFound('No entitlement with that id.');
      return { ok: true };
    });

    // --- Offerings ---
    scoped.post('/v1/admin/offerings', async (req, reply) => {
      const body = parse(offeringCreate, req.body);
      reply.code(201);
      return serializeOffering(createOffering(db, req.projectId!, body));
    });
    scoped.get('/v1/admin/offerings', async (req) => ({
      items: listOfferings(db, req.projectId!).map(serializeOffering),
    }));
    scoped.get('/v1/admin/offerings/:id', async (req) => {
      const o = getOffering(db, req.projectId!, (req.params as { id: string }).id);
      if (!o) throw notFound('No offering with that id.');
      return serializeOffering(o);
    });
    scoped.patch('/v1/admin/offerings/:id', async (req) => {
      const body = parse(offeringPatch, req.body);
      return serializeOffering(updateOffering(db, req.projectId!, (req.params as { id: string }).id, body));
    });
    scoped.delete('/v1/admin/offerings/:id', async (req) => {
      if (!deleteOffering(db, req.projectId!, (req.params as { id: string }).id))
        throw notFound('No offering with that id.');
      return { ok: true };
    });

    // --- Experiments ---
    scoped.post('/v1/admin/experiments', async (req, reply) => {
      const body = parse(experimentCreate, req.body);
      reply.code(201);
      return createExperiment(db, req.projectId!, body);
    });
    scoped.get('/v1/admin/experiments', async (req) => ({ items: listExperiments(db, req.projectId!) }));
    scoped.get('/v1/admin/experiments/:id', async (req) => {
      const e = getExperiment(db, req.projectId!, (req.params as { id: string }).id);
      if (!e) throw notFound('No experiment with that id.');
      return e;
    });
    scoped.patch('/v1/admin/experiments/:id', async (req) => {
      const body = parse(experimentPatch, req.body);
      return updateExperiment(db, req.projectId!, (req.params as { id: string }).id, body);
    });
    scoped.post('/v1/admin/experiments/:id/stop', async (req) =>
      stopExperiment(db, req.projectId!, (req.params as { id: string }).id),
    );
    scoped.get('/v1/admin/experiments/:id/results', async (req) =>
      experimentResults(db, req.projectId!, (req.params as { id: string }).id),
    );
    scoped.delete('/v1/admin/experiments/:id', async (req) => {
      if (!deleteExperiment(db, req.projectId!, (req.params as { id: string }).id))
        throw notFound('No experiment with that id.');
      return { ok: true };
    });

    // --- Apps & keys ---
    scoped.post('/v1/admin/apps', async (req, reply) => {
      const body = parse(appCreate, req.body);
      reply.code(201);
      return createApp(db, req.projectId!, body);
    });
    scoped.get('/v1/admin/apps', async (req) => ({ items: listApps(db, req.projectId!) }));
    scoped.get('/v1/admin/apps/:id', async (req) => {
      const a = getApp(db, req.projectId!, (req.params as { id: string }).id);
      if (!a) throw notFound('No app with that id.');
      return a;
    });
    scoped.delete('/v1/admin/apps/:id', async (req) => {
      if (!deleteApp(db, req.projectId!, (req.params as { id: string }).id))
        throw notFound('No app with that id.');
      return { ok: true };
    });

    // --- Receipt imports ---
    scoped.post('/v1/admin/imports', async (req) => {
      const body = parse(importsSchema, req.body);
      let imported = 0;
      const failed: { index: number; error: string }[] = [];
      for (let i = 0; i < body.receipts.length; i++) {
        const r = body.receipts[i]!;
        try {
          await processReceipt(db, validators, {
            projectId: req.projectId!,
            appUserId: r.app_user_id,
            fetchToken: r.fetch_token,
            productId: r.product_id,
            store: r.store,
            price: r.price ?? null,
            currency: r.currency ?? null,
          });
          imported++;
        } catch (err) {
          failed.push({ index: i, error: err instanceof Error ? err.message : String(err) });
        }
      }
      return { imported, failed };
    });

    // --- Subscribers ---
    scoped.get('/v1/admin/subscribers', async (req) => {
      const q = req.query as { limit?: string; offset?: string };
      const limit = Math.min(Number(q.limit ?? 100), 500);
      const offset = Number(q.offset ?? 0);
      const items = listSubscribers(db, req.projectId!, limit, offset).map((s) => {
        const info = buildCustomerInfo(db, s);
        return {
          id: s.id,
          original_app_user_id: s.original_app_user_id,
          first_seen: s.first_seen,
          last_seen: s.last_seen,
          active_entitlements: Object.keys(info.subscriber.entitlements),
          active_subscriptions: Object.keys(info.subscriber.subscriptions),
        };
      });
      return { items };
    });

    scoped.get('/v1/admin/subscribers/:appUserId', async (req) => {
      const { appUserId } = req.params as { appUserId: string };
      const sub = findSubscriber(db, req.projectId!, appUserId);
      if (!sub) throw notFound('No subscriber with that app_user_id.');
      return buildCustomerInfo(db, sub);
    });

    scoped.post('/v1/admin/subscribers/:appUserId/entitlements/:identifier/grant', async (req) => {
      const pid = req.projectId!;
      const { appUserId, identifier } = req.params as { appUserId: string; identifier: string };
      const body = parse(grantSchema, req.body);
      const ent = listEntitlements(db, pid).find((e) => e.identifier === identifier);
      if (!ent) throw notFound(`No entitlement with identifier "${identifier}".`);
      const productId = ent.product_ids[0];
      if (!productId) throw conflict('Entitlement has no products to grant.');
      const product = getProduct(db, pid, productId)!;
      const { subscriber } = getOrCreateSubscriber(db, pid, appUserId);
      upsertSubscription(db, {
        projectId: pid,
        subscriberId: subscriber.id,
        productStoreIdentifier: product.store_identifier,
        store: 'promotional',
        purchaseDate: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        expiresDate: body.expires_date ?? null,
        periodType: 'normal',
      });
      emitEvent(db, {
        projectId: pid,
        type: 'promotional_grant',
        subscriberId: subscriber.id,
        appUserId,
        productStoreIdentifier: product.store_identifier,
        store: 'promotional',
        expiresDate: body.expires_date ?? null,
      });
      return buildCustomerInfo(db, subscriber);
    });

    scoped.post('/v1/admin/subscribers/:appUserId/entitlements/:identifier/revoke', async (req) => {
      const pid = req.projectId!;
      const { appUserId, identifier } = req.params as { appUserId: string; identifier: string };
      const sub = findSubscriber(db, pid, appUserId);
      if (!sub) throw notFound('No subscriber with that app_user_id.');
      const ent = listEntitlements(db, pid).find((e) => e.identifier === identifier);
      if (!ent) throw notFound(`No entitlement with identifier "${identifier}".`);
      const storeIds = ent.product_ids.map((p) => getProduct(db, pid, p)?.store_identifier).filter(Boolean);
      for (const sid of storeIds) {
        db.prepare(
          "DELETE FROM subscriptions WHERE subscriber_id = ? AND product_store_identifier = ? AND store = 'promotional'",
        ).run(sub.id, sid);
      }
      return buildCustomerInfo(db, sub);
    });

    // --- Webhooks ---
    const webhookCreate = z.object({
      url: z.string().url(),
      events: z.union([z.literal('*'), z.array(z.string())]).optional(),
      active: z.boolean().optional(),
    });
    scoped.post('/v1/admin/webhooks', async (req, reply) => {
      const body = parse(webhookCreate, req.body);
      reply.code(201);
      return createWebhook(db, req.projectId!, body);
    });
    scoped.get('/v1/admin/webhooks', async (req) => ({ items: listWebhooks(db, req.projectId!) }));
    scoped.get('/v1/admin/webhooks/:id', async (req) => {
      const wh = getWebhook(db, req.projectId!, (req.params as { id: string }).id);
      if (!wh) throw notFound('No webhook with that id.');
      return wh;
    });
    scoped.patch('/v1/admin/webhooks/:id', async (req) => {
      const body = parse(webhookCreate.partial(), req.body);
      return updateWebhook(db, req.projectId!, (req.params as { id: string }).id, body);
    });
    scoped.delete('/v1/admin/webhooks/:id', async (req) => {
      if (!deleteWebhook(db, req.projectId!, (req.params as { id: string }).id))
        throw notFound('No webhook with that id.');
      return { ok: true };
    });
    scoped.get('/v1/admin/webhooks/:id/deliveries', async (req) => {
      const wh = getWebhook(db, req.projectId!, (req.params as { id: string }).id);
      if (!wh) throw notFound('No webhook with that id.');
      return { items: listDeliveries(db, wh.id) };
    });
    scoped.post('/v1/admin/webhooks/:id/test', async (req) => {
      const wh = getWebhook(db, req.projectId!, (req.params as { id: string }).id);
      if (!wh) throw notFound('No webhook with that id.');
      emitEvent(db, { projectId: req.projectId!, type: 'initial_purchase', appUserId: 'test_user', productStoreIdentifier: 'com.test.product', store: 'app_store', price: 9.99, currency: 'USD', periodType: 'normal' });
      return { ok: true, message: 'Test event dispatched to all active webhooks.' };
    });

    // --- Events feed ---
    scoped.get('/v1/admin/events', async (req) => {
      const q = req.query as { limit?: string };
      return { items: listEvents(db, req.projectId!, Math.min(Number(q.limit ?? 50), 200)) };
    });

    // --- SDK diagnostics ---
    scoped.get('/v1/admin/diagnostics', async (req) =>
      buildDiagnostics(db, req.projectId!, { app_store: config.appleValidation, play_store: config.googleValidation }),
    );

    // --- Dashboard analytics ---
    scoped.get('/v1/admin/overview', async (req) => {
      const q = req.query as { range?: string };
      const range = Math.min(Math.max(Number(q.range ?? 28), 1), 365);
      const { buildOverview } = await import('../services/analytics.js');
      if (Number.isNaN(range)) throw invalidRequest('range must be a number of days.');
      return buildOverview(db, req.projectId!, range);
    });

    scoped.get('/v1/admin/insights', async (req) => {
      const { buildInsights } = await import('../services/insights.js');
      return buildInsights(db, req.projectId!);
    });
  });
}
