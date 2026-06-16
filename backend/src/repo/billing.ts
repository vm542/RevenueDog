import type { DB } from '../db.js';

export interface OrgBilling {
  org_id: string;
  plan: string;
  billing_status: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
}

export function getOrgBilling(db: DB, orgId: string): OrgBilling | undefined {
  return db
    .prepare(
      'SELECT id AS org_id, plan, billing_status, stripe_customer_id, stripe_subscription_id FROM organizations WHERE id = ?',
    )
    .get(orgId) as OrgBilling | undefined;
}

export function getOrgByStripeCustomer(db: DB, stripeCustomerId: string): OrgBilling | undefined {
  return db
    .prepare(
      'SELECT id AS org_id, plan, billing_status, stripe_customer_id, stripe_subscription_id FROM organizations WHERE stripe_customer_id = ?',
    )
    .get(stripeCustomerId) as OrgBilling | undefined;
}

export function setPlan(db: DB, orgId: string, plan: string, status: string): void {
  db.prepare('UPDATE organizations SET plan = ?, billing_status = ? WHERE id = ?').run(plan, status, orgId);
}

export function setStripeIds(
  db: DB,
  orgId: string,
  customerId: string | null,
  subscriptionId: string | null,
): void {
  db.prepare(
    'UPDATE organizations SET stripe_customer_id = ?, stripe_subscription_id = ? WHERE id = ?',
  ).run(customerId, subscriptionId, orgId);
}

export interface Usage {
  subscribers: number;
  events_30d: number;
}

/** Current metered usage for an org: tracked subscribers and events in the last 30 days, across all its projects. */
export function computeUsage(db: DB, orgId: string): Usage {
  const subscribers = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM subscribers
         WHERE project_id IN (SELECT id FROM projects WHERE org_id = ?)`,
      )
      .get(orgId) as { c: number }
  ).c;
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const events = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM events
         WHERE created_at >= ? AND project_id IN (SELECT id FROM projects WHERE org_id = ?)`,
      )
      .get(since, orgId) as { c: number }
  ).c;
  return { subscribers, events_30d: events };
}
