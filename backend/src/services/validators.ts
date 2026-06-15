import type { Config } from '../config.js';
import { storeProblem } from '../errors.js';

export interface ValidationRequest {
  store: 'app_store' | 'play_store' | 'promotional';
  fetchToken: string;
  productStoreIdentifier: string;
}

export interface ValidationResult {
  /** When the store reports an explicit purchase date; falls back to "now" otherwise. */
  purchaseDate?: string;
  /** When the store reports an explicit expiry (subscriptions). Null means lifetime. */
  expiresDate?: string | null;
  isSandbox: boolean;
  periodType?: 'normal' | 'trial' | 'intro';
}

export interface StoreValidator {
  validate(req: ValidationRequest): Promise<ValidationResult>;
}

/**
 * Trust-mode validator: accepts the client's claim without contacting the store.
 * Expiry is computed by the caller from the product's configured duration.
 * Suitable for local dev and sandbox testing.
 */
class TrustValidator implements StoreValidator {
  async validate(_req: ValidationRequest): Promise<ValidationResult> {
    return { isSandbox: true };
  }
}

/** Scaffold: verify a JWS transaction via the Apple App Store Server API. */
class AppleValidator implements StoreValidator {
  async validate(_req: ValidationRequest): Promise<ValidationResult> {
    throw storeProblem('Apple App Store validation is not configured (set APPLE_* credentials).');
  }
}

/** Scaffold: verify a purchase token via the Google Play Developer API. */
class GoogleValidator implements StoreValidator {
  async validate(_req: ValidationRequest): Promise<ValidationResult> {
    throw storeProblem('Google Play validation is not configured (set GOOGLE_SERVICE_ACCOUNT_JSON).');
  }
}

export interface Validators {
  app_store: StoreValidator;
  play_store: StoreValidator;
  promotional: StoreValidator;
}

export function buildValidators(config: Config): Validators {
  const trust = new TrustValidator();
  return {
    app_store: config.appleValidation === 'apple' ? new AppleValidator() : trust,
    play_store: config.googleValidation === 'google' ? new GoogleValidator() : trust,
    promotional: trust,
  };
}
