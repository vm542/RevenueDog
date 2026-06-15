import type { DB } from '../db.js';

export interface Point {
  date: string; // YYYY-MM-DD
  value: number;
}

export interface Overview {
  generated_at: string;
  range_days: number;
  kpis: {
    active_subscriptions: number;
    active_trials: number;
    mrr: number;
    revenue: number;
    new_customers: number;
    active_subscribers: number;
    total_subscribers: number;
  };
  charts: {
    revenue: Point[];
    new_customers: Point[];
    subscriptions_started: Point[];
    active_subscriptions: Point[];
  };
  revenue_by_product: { product: string; revenue: number }[];
  subscription_status: { status: string; count: number }[];
  recent_transactions: {
    id: string;
    app_user_id: string;
    product: string;
    store: string;
    price: number | null;
    currency: string | null;
    date: string;
  }[];
}

/** Number of (fractional) months an ISO-8601 duration spans, for MRR normalization. */
function durationMonths(duration: string | null): number | null {
  if (!duration) return null;
  const m = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?$/.exec(duration);
  if (!m) return null;
  const [, y, mo, w, d] = m;
  const months = (Number(y ?? 0) * 12) + Number(mo ?? 0) + (Number(w ?? 0) * 7) / 30 + Number(d ?? 0) / 30;
  return months > 0 ? months : null;
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function emptySeries(rangeDays: number): Map<string, number> {
  const series = new Map<string, number>();
  const today = new Date();
  for (let i = rangeDays - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    series.set(dayKey(d), 0);
  }
  return series;
}

function seriesToPoints(series: Map<string, number>): Point[] {
  return [...series.entries()].map(([date, value]) => ({ date, value: Number(value.toFixed(2)) }));
}

export function buildOverview(db: DB, projectId: string, rangeDays = 28): Overview {
  const now = Date.now();
  const since = new Date(now - rangeDays * 24 * 60 * 60 * 1000).toISOString();
  const nowIsoStr = new Date(now).toISOString();

  // --- KPIs ---
  const activeSubscriptions = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM subscriptions
         WHERE project_id = ? AND (expires_date IS NULL OR expires_date > ?) AND period_type = 'normal'`,
      )
      .get(projectId, nowIsoStr) as { c: number }
  ).c;

  const activeTrials = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM subscriptions
         WHERE project_id = ? AND (expires_date IS NULL OR expires_date > ?) AND period_type IN ('trial','intro')`,
      )
      .get(projectId, nowIsoStr) as { c: number }
  ).c;

  const revenue = Number(
    (
      db
        .prepare('SELECT COALESCE(SUM(price),0) AS s FROM receipts WHERE project_id = ? AND created_at >= ?')
        .get(projectId, since) as { s: number }
    ).s ?? 0,
  );

  const newCustomers = (
    db
      .prepare('SELECT COUNT(*) AS c FROM subscribers WHERE project_id = ? AND first_seen >= ?')
      .get(projectId, since) as { c: number }
  ).c;

  const activeSubscribers = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT subscriber_id) AS c FROM subscriptions
         WHERE project_id = ? AND (expires_date IS NULL OR expires_date > ?)`,
      )
      .get(projectId, nowIsoStr) as { c: number }
  ).c;

  const totalSubscribers = (
    db.prepare('SELECT COUNT(*) AS c FROM subscribers WHERE project_id = ?').get(projectId) as { c: number }
  ).c;

  // --- MRR (normalize each active, paying subscription's last price to a monthly figure) ---
  const activeSubs = db
    .prepare(
      `SELECT s.subscriber_id, s.product_store_identifier,
              (SELECT price FROM receipts r WHERE r.subscriber_id = s.subscriber_id
                AND r.product_store_identifier = s.product_store_identifier
                ORDER BY r.created_at DESC LIMIT 1) AS price,
              (SELECT duration FROM products p WHERE p.project_id = s.project_id AND p.store_identifier = s.product_store_identifier LIMIT 1) AS duration
       FROM subscriptions s
       WHERE s.project_id = ? AND (s.expires_date IS NULL OR s.expires_date > ?) AND s.period_type = 'normal'`,
    )
    .all(projectId, nowIsoStr) as { price: number | null; duration: string | null }[];
  let mrr = 0;
  for (const row of activeSubs) {
    const months = durationMonths(row.duration);
    if (row.price && months) mrr += row.price / months;
  }

  // --- Charts ---
  const revenueSeries = emptySeries(rangeDays);
  for (const r of db
    .prepare(
      `SELECT substr(created_at,1,10) AS day, COALESCE(SUM(price),0) AS s
       FROM receipts WHERE project_id = ? AND created_at >= ? GROUP BY day`,
    )
    .all(projectId, since) as { day: string; s: number }[]) {
    if (revenueSeries.has(r.day)) revenueSeries.set(r.day, Number(r.s ?? 0));
  }

  const newCustomersSeries = emptySeries(rangeDays);
  for (const r of db
    .prepare(
      `SELECT substr(first_seen,1,10) AS day, COUNT(*) AS c
       FROM subscribers WHERE project_id = ? AND first_seen >= ? GROUP BY day`,
    )
    .all(projectId, since) as { day: string; c: number }[]) {
    if (newCustomersSeries.has(r.day)) newCustomersSeries.set(r.day, r.c);
  }

  const subsStartedSeries = emptySeries(rangeDays);
  for (const r of db
    .prepare(
      `SELECT substr(purchase_date,1,10) AS day, COUNT(*) AS c
       FROM subscriptions WHERE project_id = ? AND purchase_date >= ? GROUP BY day`,
    )
    .all(projectId, since) as { day: string; c: number }[]) {
    if (subsStartedSeries.has(r.day)) subsStartedSeries.set(r.day, r.c);
  }

  // Active subscriptions per day: subs whose window covers the end of that day.
  const activeSeries = emptySeries(rangeDays);
  const allSubs = db
    .prepare('SELECT purchase_date, expires_date FROM subscriptions WHERE project_id = ?')
    .all(projectId) as { purchase_date: string; expires_date: string | null }[];
  for (const day of activeSeries.keys()) {
    const dayEnd = new Date(`${day}T23:59:59Z`).getTime();
    let count = 0;
    for (const s of allSubs) {
      const start = new Date(s.purchase_date).getTime();
      const end = s.expires_date ? new Date(s.expires_date).getTime() : Infinity;
      if (start <= dayEnd && end >= dayEnd) count++;
    }
    activeSeries.set(day, count);
  }

  // --- Revenue by product ---
  const revenueByProduct = (
    db
      .prepare(
        `SELECT COALESCE(p.display_name, r.product_store_identifier) AS product, COALESCE(SUM(r.price),0) AS revenue
         FROM receipts r LEFT JOIN products p ON p.id = r.product_id
         WHERE r.project_id = ?
         GROUP BY product ORDER BY revenue DESC LIMIT 10`,
      )
      .all(projectId) as { product: string; revenue: number }[]
  ).map((r) => ({ product: r.product, revenue: Number((r.revenue ?? 0).toFixed(2)) }));

  // --- Subscription status breakdown ---
  const statusRows = db.prepare('SELECT * FROM subscriptions WHERE project_id = ?').all(projectId) as {
    expires_date: string | null;
    period_type: string;
    billing_issues_detected_at: string | null;
    grace_period_expires_date: string | null;
  }[];
  const status = { active: 0, trial: 0, expired: 0, billing_issue: 0 };
  for (const s of statusRows) {
    const active = s.expires_date === null || new Date(s.expires_date).getTime() > now;
    if (s.billing_issues_detected_at) status.billing_issue++;
    else if (!active) status.expired++;
    else if (s.period_type === 'trial' || s.period_type === 'intro') status.trial++;
    else status.active++;
  }
  const subscriptionStatus = Object.entries(status).map(([k, v]) => ({ status: k, count: v }));

  // --- Recent transactions ---
  const recent = (
    db
      .prepare(
        `SELECT r.id, r.store, r.price, r.currency, r.created_at AS date,
                COALESCE(p.display_name, r.product_store_identifier) AS product,
                (SELECT a.app_user_id FROM aliases a WHERE a.subscriber_id = r.subscriber_id LIMIT 1) AS app_user_id
         FROM receipts r LEFT JOIN products p ON p.id = r.product_id
         WHERE r.project_id = ?
         ORDER BY r.created_at DESC LIMIT 15`,
      )
      .all(projectId) as Overview['recent_transactions']
  );

  return {
    generated_at: nowIsoStr,
    range_days: rangeDays,
    kpis: {
      active_subscriptions: activeSubscriptions,
      active_trials: activeTrials,
      mrr: Number(mrr.toFixed(2)),
      revenue: Number(revenue.toFixed(2)),
      new_customers: newCustomers,
      active_subscribers: activeSubscribers,
      total_subscribers: totalSubscribers,
    },
    charts: {
      revenue: seriesToPoints(revenueSeries),
      new_customers: seriesToPoints(newCustomersSeries),
      subscriptions_started: seriesToPoints(subsStartedSeries),
      active_subscriptions: seriesToPoints(activeSeries),
    },
    revenue_by_product: revenueByProduct,
    subscription_status: subscriptionStatus,
    recent_transactions: recent,
  };
}
