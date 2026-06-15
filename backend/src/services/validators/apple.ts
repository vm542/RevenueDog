import { receiptValidationFailed } from '../../errors.js';
import { verifyAppleJws } from '../jws.js';
import type { StoreValidator, ValidationRequest, ValidationResult } from './types.js';

interface AppleTransactionPayload {
  transactionId?: string;
  originalTransactionId?: string;
  productId?: string;
  purchaseDate?: number; // epoch ms
  originalPurchaseDate?: number;
  expiresDate?: number; // epoch ms (subscriptions)
  type?: string; // "Auto-Renewable Subscription" | "Non-Consumable" | ...
  inAppOwnershipType?: string;
  environment?: string; // "Sandbox" | "Production"
  offerType?: number; // 1 = intro, 2 = promo, 3 = offer code
  offerDiscountType?: string; // "FREE_TRIAL" | "PAY_AS_YOU_GO" | "PAY_UP_FRONT"
}

/**
 * Verifies an App Store StoreKit 2 signed transaction (JWS) cryptographically via the
 * shared Apple JWS verifier (ES256 signature + x5c chain, optional root-CA pinning),
 * then returns the authentic purchase/expiry dates and environment.
 */
export class AppleValidator implements StoreValidator {
  constructor(private rootCaPem = process.env.APPLE_ROOT_CA_PEM) {}

  async validate(req: ValidationRequest): Promise<ValidationResult> {
    const payload = verifyAppleJws<AppleTransactionPayload>(req.fetchToken, this.rootCaPem);

    if (payload.productId && req.productStoreIdentifier && payload.productId !== req.productStoreIdentifier) {
      throw receiptValidationFailed(
        `App Store token productId "${payload.productId}" does not match "${req.productStoreIdentifier}".`,
      );
    }

    const isFreeTrial = payload.offerType === 1 && payload.offerDiscountType === 'FREE_TRIAL';
    return {
      purchaseDate: payload.purchaseDate ? new Date(payload.purchaseDate).toISOString() : undefined,
      expiresDate: payload.expiresDate
        ? new Date(payload.expiresDate).toISOString()
        : payload.type?.includes('Subscription')
          ? undefined
          : null,
      isSandbox: payload.environment === 'Sandbox',
      periodType: isFreeTrial ? 'trial' : payload.offerType ? 'intro' : 'normal',
    };
  }
}
