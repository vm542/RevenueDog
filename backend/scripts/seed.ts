/**
 * Seeds a RevenueDog database with a demo app, products, an entitlement, an offering,
 * an A/B experiment, and ~3 months of realistic subscribers/receipts so the dashboard
 * has charts to render. Safe to run against a fresh DB.
 *
 *   npm run seed
 */
import { ensureRootSecretKey } from '../src/auth.js';
import { loadConfig } from '../src/config.js';
import { openDb, type DB } from '../src/db.js';
import { addDuration } from '../src/duration.js';
import { genId } from '../src/ids.js';
import { createApp } from '../src/repo/apps.js';
import { createProduct, type ProductRow } from '../src/repo/products.js';
import { createEntitlement } from '../src/repo/entitlements.js';
import { createOffering } from '../src/repo/offerings.js';
import { createExperiment } from '../src/repo/experiments.js';
import { getDefaultProjectId } from '../src/repo/projects.js';

function iso(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function seed(db: DB): void {
  const projectId = getDefaultProjectId(db);
  const app = createApp(db, projectId, { name: 'Demo App', bundle_id: 'com.demo.app', package_name: 'com.demo.app' });

  const products: Record<string, ProductRow> = {};
  const defs: { key: string; id: string; type: 'subscription' | 'non_consumable'; duration: string | null; price: number; name: string }[] = [
    { key: 'monthly_ios', id: 'com.demo.pro.monthly', type: 'subscription', duration: 'P1M', price: 9.99, name: 'Pro Monthly' },
    { key: 'annual_ios', id: 'com.demo.pro.annual', type: 'subscription', duration: 'P1Y', price: 59.99, name: 'Pro Annual' },
    { key: 'weekly_ios', id: 'com.demo.pro.weekly', type: 'subscription', duration: 'P1W', price: 2.99, name: 'Pro Weekly' },
    { key: 'lifetime_ios', id: 'com.demo.lifetime', type: 'non_consumable', duration: null, price: 99.99, name: 'Lifetime' },
  ];
  for (const d of defs) {
    products[d.key] = createProduct(db, projectId, {
      store_identifier: d.id,
      type: d.type,
      store: 'app_store',
      display_name: d.name,
      duration: d.duration,
    });
    // Mirror on Play store too.
    createProduct(db, projectId, {
      store_identifier: d.id,
      type: d.type,
      store: 'play_store',
      display_name: d.name,
      duration: d.duration,
    });
  }

  const pro = createEntitlement(db, projectId, {
    identifier: 'pro',
    display_name: 'Pro access',
    product_ids: defs.map((d) => products[d.key]!.id),
  });

  const def = createOffering(db, projectId, {
    identifier: 'default',
    description: 'Standard paywall',
    is_current: true,
    packages: [
      { identifier: '$rd_weekly', product_ids: [products.weekly_ios!.id] },
      { identifier: '$rd_monthly', product_ids: [products.monthly_ios!.id] },
      { identifier: '$rd_annual', product_ids: [products.annual_ios!.id] },
      { identifier: '$rd_lifetime', product_ids: [products.lifetime_ios!.id] },
    ],
  });

  const annualFirst = createOffering(db, projectId, {
    identifier: 'annual_first',
    description: 'Annual-first paywall (experiment)',
    packages: [
      { identifier: '$rd_annual', product_ids: [products.annual_ios!.id] },
      { identifier: '$rd_monthly', product_ids: [products.monthly_ios!.id] },
    ],
  });

  const experiment = createExperiment(db, projectId, {
    name: 'Annual-first paywall',
    status: 'running',
    control_offering_id: def.id,
    treatment_offering_id: annualFirst.id,
    traffic_pct: 50,
  });

  const priceByProduct: Record<string, number> = Object.fromEntries(defs.map((d) => [products[d.key]!.store_identifier, d.price]));

  const insertSub = db.prepare(
    `INSERT INTO subscribers (id, project_id, original_app_user_id, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)`,
  );
  const insertAlias = db.prepare('INSERT INTO aliases (project_id, app_user_id, subscriber_id) VALUES (?, ?, ?)');
  const insertSubscription = db.prepare(
    `INSERT INTO subscriptions (id, project_id, subscriber_id, product_store_identifier, store, purchase_date,
      original_purchase_date, expires_date, unsubscribe_detected_at, billing_issues_detected_at,
      grace_period_expires_date, is_sandbox, period_type, will_renew)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, 0, ?, ?)`,
  );
  const insertNonSub = db.prepare(
    `INSERT INTO non_subscriptions (id, project_id, subscriber_id, product_store_identifier, store, purchase_date, is_sandbox)
     VALUES (?, ?, ?, ?, ?, ?, 0)`,
  );
  const insertReceipt = db.prepare(
    `INSERT INTO receipts (id, project_id, store, fetch_token, subscriber_id, product_id, product_store_identifier,
      presented_offering_identifier, price, currency, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'default', ?, 'USD', ?)`,
  );

  const subProducts = [products.weekly_ios!, products.monthly_ios!, products.annual_ios!];
  const COUNT = 220;
  const seedAll = db.transaction(() => {
    for (let i = 0; i < COUNT; i++) {
      const subId = genId('sub');
      const appUserId = `user_${i + 1}`;
      const firstSeenDays = Math.floor(Math.random() * 90);
      const first = daysAgo(firstSeenDays);
      insertSub.run(subId, projectId, appUserId, iso(first), iso(daysAgo(Math.floor(Math.random() * firstSeenDays + 0.0001))));
      insertAlias.run(projectId, appUserId, subId);

      // ~55% of users buy something
      if (Math.random() > 0.55) continue;
      const store = Math.random() > 0.5 ? 'app_store' : 'play_store';

      if (Math.random() < 0.12) {
        // lifetime purchase
        const p = products.lifetime_ios!;
        const purchase = first;
        insertNonSub.run(genId('txn'), projectId, subId, p.store_identifier, store, iso(purchase));
        insertReceipt.run(genId('rcpt'), projectId, store, genId('tok'), subId, p.id, p.store_identifier, priceByProduct[p.store_identifier], iso(purchase));
        continue;
      }

      const p = pick(subProducts);
      const purchase = first;
      const isTrial = Math.random() < 0.25;
      const expires = addDuration(iso(purchase), p.duration!);
      const periodType = isTrial ? 'trial' : 'normal';
      const billingIssue = Math.random() < 0.06 ? iso(daysAgo(2)) : null;
      insertSubscription.run(
        genId('subscription'), projectId, subId, p.store_identifier, store, iso(purchase), iso(purchase), expires,
        billingIssue, periodType, Math.random() < 0.85 ? 1 : 0,
      );
      insertReceipt.run(genId('rcpt'), projectId, store, genId('tok'), subId, p.id, p.store_identifier, priceByProduct[p.store_identifier], iso(purchase));

      // Some renewals add extra revenue points
      if (!isTrial && Math.random() < 0.4) {
        const renewDate = addDuration(iso(purchase), p.duration!);
        if (new Date(renewDate).getTime() < Date.now()) {
          insertReceipt.run(genId('rcpt'), projectId, store, genId('tok'), subId, p.id, p.store_identifier, priceByProduct[p.store_identifier], renewDate);
        }
      }
    }
  });
  seedAll();

  // Enroll every subscriber into the running experiment (deterministic-ish 50/50),
  // so the experiment results page shows real conversion numbers.
  const enroll = db.prepare(
    'INSERT OR IGNORE INTO experiment_enrollments (experiment_id, subscriber_id, variant, enrolled_at) VALUES (?, ?, ?, ?)',
  );
  const allSubscribers = db.prepare('SELECT id, first_seen FROM subscribers').all() as {
    id: string;
    first_seen: string;
  }[];
  db.transaction(() => {
    for (const s of allSubscribers) {
      const variant = Math.random() < 0.5 ? 'treatment' : 'control';
      enroll.run(experiment.id, s.id, variant, s.first_seen);
    }
  })();

  console.log('\n  RevenueDog demo data seeded.');
  console.log('  ----------------------------------------');
  console.log(`  App:        ${app.name} (${app.id})`);
  console.log(`  Public key: ${app.public_api_key}`);
  console.log(`  Products:   ${defs.length} (x2 stores)`);
  console.log(`  Entitlement:${pro.identifier}`);
  console.log(`  Offerings:  default (current), annual_first (experiment)`);
  console.log(`  Subscribers:${COUNT}`);
  console.log('  ----------------------------------------\n');
}

const config = loadConfig();
const db = openDb(config.dbPath);
const rootKey = ensureRootSecretKey(db);
seed(db);
console.log(`  Secret key (admin/dashboard): ${rootKey}\n`);
