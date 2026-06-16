import { createHmac, timingSafeEqual } from 'node:crypto';
import type { DB } from '../db.js';
import { storeProblem } from '../errors.js';
import { PLANS, type PlanId } from '../billing.js';
import { getOrgByStripeCustomer, setPlan, setStripeIds } from '../repo/billing.js';

/**
 * Stripe integration with no SDK dependency — talks to Stripe's REST API via fetch, and
 * is only active when STRIPE_SECRET_KEY is configured. The webhook handler is pure and
 * testable; checkout requires live credentials.
 */

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/** Creates a Stripe Checkout session for a plan and returns its URL. Requires live credentials. */
export async function createCheckoutSession(input: {
  plan: PlanId;
  orgId: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ url: string }> {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw storeProblem('Billing is not configured (STRIPE_SECRET_KEY missing).');
  const priceVar = PLANS[input.plan].priceEnvVar;
  const priceId = priceVar ? process.env[priceVar] : undefined;
  if (!priceId) throw storeProblem(`No Stripe price configured for the "${input.plan}" plan.`);

  const form = new URLSearchParams({
    mode: 'subscription',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: input.orgId,
    customer_email: input.customerEmail,
    'metadata[org_id]': input.orgId,
    'metadata[plan]': input.plan,
  });
  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form,
  });
  const json = (await res.json()) as { url?: string; error?: { message?: string } };
  if (!res.ok || !json.url) throw storeProblem(json.error?.message ?? 'Stripe checkout failed.');
  return { url: json.url };
}

/** Verifies a Stripe webhook signature (HMAC-SHA256 over `${t}.${payload}`). */
export function verifyStripeSignature(payload: string, sigHeader: string | undefined, secret: string): boolean {
  if (!sigHeader) return false;
  const parts = Object.fromEntries(sigHeader.split(',').map((kv) => kv.split('=')));
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  const a = Buffer.from(v1);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function mapStatus(stripeStatus: string | undefined): string {
  switch (stripeStatus) {
    case 'active':
    case 'trialing':
      return 'active';
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    case 'canceled':
    case 'incomplete_expired':
      return 'canceled';
    default:
      return stripeStatus ?? 'active';
  }
}

interface StripeEvent {
  type: string;
  data?: { object?: Record<string, unknown> };
}

/** Applies a (subset of) Stripe billing events to the organization's plan/status. */
export function processStripeEvent(db: DB, event: StripeEvent): { ok: boolean; handled: string } {
  const obj = (event.data?.object ?? {}) as Record<string, unknown>;
  const metadata = (obj.metadata ?? {}) as Record<string, string>;

  switch (event.type) {
    case 'checkout.session.completed': {
      const orgId = (obj.client_reference_id as string) ?? metadata.org_id;
      if (!orgId) return { ok: false, handled: 'no_org' };
      setStripeIds(db, orgId, (obj.customer as string) ?? null, (obj.subscription as string) ?? null);
      setPlan(db, orgId, (metadata.plan as PlanId) ?? 'pro', 'active');
      return { ok: true, handled: event.type };
    }
    case 'customer.subscription.updated': {
      const org = getOrgByStripeCustomer(db, obj.customer as string);
      if (!org) return { ok: false, handled: 'unknown_customer' };
      const plan = (metadata.plan as PlanId) ?? (org.plan as PlanId) ?? 'pro';
      setPlan(db, org.org_id, plan, mapStatus(obj.status as string));
      return { ok: true, handled: event.type };
    }
    case 'customer.subscription.deleted': {
      const org = getOrgByStripeCustomer(db, obj.customer as string);
      if (!org) return { ok: false, handled: 'unknown_customer' };
      setPlan(db, org.org_id, 'free', 'canceled');
      return { ok: true, handled: event.type };
    }
    default:
      return { ok: true, handled: `ignored:${event.type}` };
  }
}
