import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { isOverLimit, planFor, type PlanId } from '../billing.js';
import type { DB } from '../db.js';
import { notFound } from '../errors.js';
import { parse } from '../validate.js';
import { requireUser } from './accounts.js';
import { getUser } from '../repo/accounts.js';
import { computeUsage, getOrgBilling } from '../repo/billing.js';
import {
  createCheckoutSession,
  processStripeEvent,
  stripeConfigured,
  verifyStripeSignature,
} from '../services/stripe.js';

const checkoutSchema = z.object({
  plan: z.enum(['pro', 'scale']),
  success_url: z.string().url(),
  cancel_url: z.string().url(),
});

export function registerBillingRoutes(app: FastifyInstance, db: DB): void {
  // --- Session-authenticated billing endpoints ---
  app.register(async (scoped) => {
    scoped.addHook('preHandler', requireUser(db));

    scoped.get('/v1/billing', async (req) => {
      const orgId = req.user!.org_id;
      const billing = getOrgBilling(db, orgId);
      if (!billing) throw notFound('No organization.');
      const plan = planFor(billing.plan);
      const usage = computeUsage(db, orgId);
      return {
        plan: { id: plan.id, name: plan.name, max_subscribers: numberOrNull(plan.maxSubscribers) },
        billing_status: billing.billing_status,
        usage,
        over_limit: isOverLimit(plan, usage.subscribers),
        stripe_configured: stripeConfigured(),
      };
    });

    scoped.post('/v1/billing/checkout', async (req) => {
      const body = parse(checkoutSchema, req.body);
      const user = getUser(db, req.user!.id)!;
      return createCheckoutSession({
        plan: body.plan as PlanId,
        orgId: user.org_id,
        customerEmail: user.email,
        successUrl: body.success_url,
        cancelUrl: body.cancel_url,
      });
    });
  });

  // --- Stripe webhook (public). Encapsulated raw-body parser so the signature can be
  //     verified over the exact bytes Stripe signed. ---
  app.register(async (scoped) => {
    scoped.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
      (req as FastifyRequest & { rawBody?: string }).rawBody = body as string;
      try {
        done(null, body ? JSON.parse(body as string) : {});
      } catch (err) {
        done(err as Error);
      }
    });

    scoped.post('/v1/billing/webhook', async (req, reply) => {
      const secret = process.env.STRIPE_WEBHOOK_SECRET;
      if (secret) {
        const raw = (req as FastifyRequest & { rawBody?: string }).rawBody ?? '';
        if (!verifyStripeSignature(raw, req.headers['stripe-signature'] as string | undefined, secret)) {
          reply.code(400).send({ error: { code: 'invalid_request', message: 'Invalid Stripe signature.' } });
          return;
        }
      }
      return processStripeEvent(db, req.body as { type: string });
    });
  });
}

function numberOrNull(n: number): number | null {
  return Number.isFinite(n) ? n : null;
}
