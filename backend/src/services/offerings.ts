import { createHash } from 'node:crypto';
import type { DB } from '../db.js';
import { getProduct, type ProductStore } from '../repo/products.js';
import { enroll, getEnrollment, getRunningExperiment, type Variant } from '../repo/experiments.js';
import { getCurrentOffering, getOffering, listOfferings, type Offering } from '../repo/offerings.js';
import type { SubscriberRow } from '../repo/subscribers.js';

export type Platform = 'ios' | 'android';

export interface ResolvedPackage {
  identifier: string;
  platform_product_identifier: string;
  /** Google Play base-plan id; null on App Store. Mirrors RevenueCat's offerings payload. */
  platform_product_plan_identifier: string | null;
}

export interface ResolvedOffering {
  identifier: string;
  description: string;
  metadata: Record<string, unknown>;
  packages: ResolvedPackage[];
}

export interface OfferingsResponse {
  current_offering_id: string | null;
  offerings: ResolvedOffering[];
  experiment: { id: string; variant: Variant } | null;
}

function storeForPlatform(platform: Platform): ProductStore {
  return platform === 'ios' ? 'app_store' : 'play_store';
}

/** Deterministic [0,100) bucket from an experiment + subscriber pair. */
function bucket(experimentId: string, subscriberId: string): number {
  const hash = createHash('sha256').update(`${experimentId}:${subscriberId}`).digest();
  return hash.readUInt32BE(0) % 100;
}

function resolveOffering(db: DB, offering: Offering, platform: Platform): ResolvedOffering {
  const store = storeForPlatform(platform);
  const packages: ResolvedPackage[] = [];
  for (const pkg of offering.packages) {
    const products = pkg.product_ids.map((id) => getProduct(db, id)).filter((p) => p !== undefined);
    const match = products.find((p) => p!.store === store);
    if (!match) continue; // never surface a package with no product for this platform
    packages.push({
      identifier: pkg.identifier,
      platform_product_identifier: match.store_identifier,
      platform_product_plan_identifier: null,
    });
  }
  return {
    identifier: offering.identifier,
    description: offering.description,
    metadata: offering.metadata,
    packages,
  };
}

/**
 * Resolves the offerings response for a subscriber + platform, applying experiment
 * assignment (sticky, deterministic) when a running experiment exists.
 */
export function resolveOfferings(db: DB, subscriber: SubscriberRow, platform: Platform): OfferingsResponse {
  let currentOfferingId: string | null = getCurrentOffering(db)?.identifier ?? null;
  let experiment: { id: string; variant: Variant } | null = null;

  const running = getRunningExperiment(db);
  if (running) {
    let variant: Variant;
    const enrollment = getEnrollment(db, running.id, subscriber.id);
    if (enrollment) {
      variant = enrollment.variant;
    } else {
      variant = bucket(running.id, subscriber.id) < running.traffic_pct ? 'treatment' : 'control';
      enroll(db, running.id, subscriber.id, variant);
    }
    const variantOfferingId = variant === 'treatment' ? running.treatment_offering_id : running.control_offering_id;
    const variantOffering = getOffering(db, variantOfferingId);
    if (variantOffering) {
      currentOfferingId = variantOffering.identifier;
      experiment = { id: running.id, variant };
    }
  }

  const offerings = listOfferings(db).map((o) => resolveOffering(db, o, platform));
  return { current_offering_id: currentOfferingId, offerings, experiment };
}
