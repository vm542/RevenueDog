import type { DB } from '../db.js';
import { nowIso } from '../ids.js';

export interface Insights {
  generated_at: string;
  funnel: { stage: string; count: number }[];
  trial_conversion: { trials: number; converted: number; rate: number };
  ltv: { total_customers: number; paying_customers: number; total_revenue: number; arpu: number; arppu: number };
  cohorts: {
    cohort: string;
    customers: number;
    paying: number;
    revenue: number;
    revenue_per_customer: number;
    active_now: number;
    retention_pct: number;
  }[];
}

function scalar(db: DB, sql: string, ...params: unknown[]): number {
  return Number((db.prepare(sql).get(...params) as { v: number }).v ?? 0);
}

export function buildInsights(db: DB): Insights {
  const now = nowIso();

  const totalCustomers = scalar(db, 'SELECT COUNT(*) AS v FROM subscribers');
  const purchased = scalar(db, 'SELECT COUNT(DISTINCT subscriber_id) AS v FROM receipts');
  const subscribers = scalar(db, 'SELECT COUNT(DISTINCT subscriber_id) AS v FROM subscriptions');
  const activeNow = scalar(
    db,
    'SELECT COUNT(DISTINCT subscriber_id) AS v FROM subscriptions WHERE expires_date IS NULL OR expires_date > ?',
    now,
  );

  const funnel = [
    { stage: 'Customers', count: totalCustomers },
    { stage: 'Made a purchase', count: purchased },
    { stage: 'Subscribed', count: subscribers },
    { stage: 'Active now', count: activeNow },
  ];

  // Trial conversion: subscribers who started a trial, and how many also hold a paying subscription.
  const trials = scalar(
    db,
    "SELECT COUNT(DISTINCT subscriber_id) AS v FROM subscriptions WHERE period_type IN ('trial','intro')",
  );
  const converted = scalar(
    db,
    `SELECT COUNT(DISTINCT t.subscriber_id) AS v
     FROM subscriptions t
     JOIN subscriptions p ON p.subscriber_id = t.subscriber_id AND p.period_type = 'normal'
     WHERE t.period_type IN ('trial','intro')`,
  );
  const trialConversion = { trials, converted, rate: trials ? Number(((converted / trials) * 100).toFixed(1)) : 0 };

  const totalRevenue = scalar(db, 'SELECT COALESCE(SUM(price),0) AS v FROM receipts');
  const payingCustomers = scalar(db, 'SELECT COUNT(DISTINCT subscriber_id) AS v FROM receipts WHERE price > 0');
  const ltv = {
    total_customers: totalCustomers,
    paying_customers: payingCustomers,
    total_revenue: Number(totalRevenue.toFixed(2)),
    arpu: totalCustomers ? Number((totalRevenue / totalCustomers).toFixed(2)) : 0,
    arppu: payingCustomers ? Number((totalRevenue / payingCustomers).toFixed(2)) : 0,
  };

  // Monthly signup cohorts: size, paying, revenue, current retention.
  const cohortRows = db
    .prepare(
      `SELECT substr(first_seen,1,7) AS cohort, COUNT(*) AS customers
       FROM subscribers GROUP BY cohort ORDER BY cohort DESC LIMIT 12`,
    )
    .all() as { cohort: string; customers: number }[];

  const cohorts = cohortRows.map((c) => {
    const paying = scalar(
      db,
      `SELECT COUNT(DISTINCT r.subscriber_id) AS v FROM receipts r
       JOIN subscribers s ON s.id = r.subscriber_id
       WHERE substr(s.first_seen,1,7) = ? AND r.price > 0`,
      c.cohort,
    );
    const revenue = scalar(
      db,
      `SELECT COALESCE(SUM(r.price),0) AS v FROM receipts r
       JOIN subscribers s ON s.id = r.subscriber_id
       WHERE substr(s.first_seen,1,7) = ?`,
      c.cohort,
    );
    const activeNowCohort = scalar(
      db,
      `SELECT COUNT(DISTINCT sub.subscriber_id) AS v FROM subscriptions sub
       JOIN subscribers s ON s.id = sub.subscriber_id
       WHERE substr(s.first_seen,1,7) = ? AND (sub.expires_date IS NULL OR sub.expires_date > ?)`,
      c.cohort,
      now,
    );
    return {
      cohort: c.cohort,
      customers: c.customers,
      paying,
      revenue: Number(revenue.toFixed(2)),
      revenue_per_customer: c.customers ? Number((revenue / c.customers).toFixed(2)) : 0,
      active_now: activeNowCohort,
      retention_pct: c.customers ? Number(((activeNowCohort / c.customers) * 100).toFixed(1)) : 0,
    };
  });

  return { generated_at: now, funnel, trial_conversion: trialConversion, ltv, cohorts };
}
