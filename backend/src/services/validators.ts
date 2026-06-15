import type { Config } from '../config.js';
import { AppleValidator } from './validators/apple.js';
import { GoogleValidator } from './validators/google.js';
import type { StoreValidator, ValidationRequest, ValidationResult } from './validators/types.js';

export type { StoreValidator, ValidationRequest, ValidationResult };

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
