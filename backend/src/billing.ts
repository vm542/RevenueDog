/**
 * Billing plans. RevenueDog (hosted) meters tracked subscribers per organization,
 * the way RevenueCat meters revenue: the free tier is generous, paid tiers raise the
 * cap. Limits are advisory — going over flips the org's usage to `over_limit` and is
 * surfaced in the billing API/dashboard; purchases are never blocked.
 */
export type PlanId = 'free' | 'pro' | 'scale';

export interface Plan {
  id: PlanId;
  name: string;
  /** Max tracked subscribers included; Infinity = unmetered. */
  maxSubscribers: number;
  /** Stripe price id (set per deployment via env), used to start a checkout. */
  priceEnvVar?: string;
}

export const PLANS: Record<PlanId, Plan> = {
  free: { id: 'free', name: 'Free', maxSubscribers: 1_000 },
  pro: { id: 'pro', name: 'Pro', maxSubscribers: 100_000, priceEnvVar: 'STRIPE_PRICE_PRO' },
  scale: { id: 'scale', name: 'Scale', maxSubscribers: Number.POSITIVE_INFINITY, priceEnvVar: 'STRIPE_PRICE_SCALE' },
};

export function planFor(id: string | null | undefined): Plan {
  return PLANS[(id as PlanId) ?? 'free'] ?? PLANS.free;
}

export function isOverLimit(plan: Plan, subscribers: number): boolean {
  return subscribers > plan.maxSubscribers;
}
