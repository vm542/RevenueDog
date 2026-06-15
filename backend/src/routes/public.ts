import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DB } from '../db.js';
import { invalidRequest, notFound } from '../errors.js';
import { requirePublicKey } from '../auth.js';
import { parse } from '../validate.js';
import {
  aliasSubscriber,
  deleteSubscriber,
  findSubscriber,
  getOrCreateSubscriber,
  setAttribute,
} from '../repo/subscribers.js';
import { buildCustomerInfo } from '../services/customerInfo.js';
import { resolveOfferings, type Platform } from '../services/offerings.js';
import { processReceipt } from '../services/receipts.js';
import type { Validators } from '../services/validators.js';

function platformFrom(req: { headers: Record<string, unknown> }): Platform {
  const raw = String(req.headers['x-platform'] ?? '').toLowerCase();
  if (raw === 'ios' || raw === 'android') return raw;
  throw invalidRequest('Missing or invalid X-Platform header (expected "ios" or "android").');
}

const receiptSchema = z.object({
  app_user_id: z.string().min(1),
  fetch_token: z.string().min(1),
  product_id: z.string().min(1),
  store: z.enum(['app_store', 'play_store']),
  presented_offering_identifier: z.string().nullish(),
  price: z.number().nullish(),
  currency: z.string().nullish(),
});

const aliasSchema = z.object({ new_app_user_id: z.string().min(1) });

const attributesSchema = z.object({
  attributes: z.record(z.object({ value: z.string().nullable() })),
});

export function registerPublicRoutes(app: FastifyInstance, db: DB, validators: Validators): void {
  app.register(async (scoped) => {
    scoped.addHook('preHandler', requirePublicKey(db));

    scoped.get('/v1/subscribers/:appUserId', async (req) => {
      const { appUserId } = req.params as { appUserId: string };
      const { subscriber } = getOrCreateSubscriber(db, appUserId);
      return buildCustomerInfo(db, subscriber);
    });

    scoped.get('/v1/subscribers/:appUserId/offerings', async (req) => {
      const { appUserId } = req.params as { appUserId: string };
      const platform = platformFrom(req);
      const { subscriber } = getOrCreateSubscriber(db, appUserId);
      return resolveOfferings(db, subscriber, platform);
    });

    scoped.post('/v1/receipts', async (req) => {
      const body = parse(receiptSchema, req.body);
      return processReceipt(db, validators, {
        appUserId: body.app_user_id,
        fetchToken: body.fetch_token,
        productId: body.product_id,
        store: body.store,
        presentedOfferingIdentifier: body.presented_offering_identifier ?? null,
        price: body.price ?? null,
        currency: body.currency ?? null,
      });
    });

    scoped.post('/v1/subscribers/:appUserId/alias', async (req) => {
      const { appUserId } = req.params as { appUserId: string };
      const body = parse(aliasSchema, req.body);
      const { subscriber, created } = aliasSubscriber(db, appUserId, body.new_app_user_id);
      return { ...buildCustomerInfo(db, subscriber), created };
    });

    scoped.post('/v1/subscribers/:appUserId/attributes', async (req) => {
      const { appUserId } = req.params as { appUserId: string };
      const body = parse(attributesSchema, req.body);
      const { subscriber } = getOrCreateSubscriber(db, appUserId);
      for (const [key, entry] of Object.entries(body.attributes)) {
        setAttribute(db, subscriber.id, key, entry.value);
      }
      return { ok: true };
    });

    scoped.delete('/v1/subscribers/:appUserId', async (req) => {
      const { appUserId } = req.params as { appUserId: string };
      const existed = deleteSubscriber(db, appUserId);
      if (!existed && !findSubscriber(db, appUserId)) throw notFound('No subscriber with that app_user_id.');
      return { ok: true };
    });
  });
}
