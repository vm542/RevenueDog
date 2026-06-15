import { X509Certificate, verify as cryptoVerify } from 'node:crypto';
import { receiptValidationFailed, storeProblem } from '../../errors.js';
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

function b64urlToBuffer(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function decodeSegment<T>(segment: string): T {
  return JSON.parse(b64urlToBuffer(segment).toString('utf8')) as T;
}

function certFromX5c(b64: string): X509Certificate {
  return new X509Certificate(Buffer.from(b64, 'base64'));
}

/**
 * Verifies an App Store StoreKit 2 signed transaction (JWS) cryptographically:
 * checks the ES256 signature with the leaf certificate, validates the x5c chain
 * links (leaf ← intermediate ← root) and certificate validity windows, and — when
 * `APPLE_ROOT_CA_PEM` is provided — pins the chain to Apple's root CA. Returns the
 * authentic purchase/expiry dates and environment from the signed payload.
 */
export class AppleValidator implements StoreValidator {
  constructor(private rootCaPem = process.env.APPLE_ROOT_CA_PEM) {}

  async validate(req: ValidationRequest): Promise<ValidationResult> {
    const parts = req.fetchToken.split('.');
    if (parts.length !== 3) {
      throw receiptValidationFailed('App Store token is not a valid JWS (expected 3 segments).');
    }
    const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

    let header: { alg?: string; x5c?: string[] };
    try {
      header = decodeSegment(headerB64);
    } catch {
      throw receiptValidationFailed('Could not decode App Store token header.');
    }
    if (header.alg !== 'ES256' || !header.x5c?.length) {
      throw receiptValidationFailed('App Store token must be ES256-signed with an x5c chain.');
    }

    const chain = header.x5c.map(certFromX5c);
    this.verifyChain(chain);

    // Verify the JWS signature with the leaf certificate's public key (ES256 / IEEE-P1363).
    const leaf = chain[0]!;
    const signingInput = Buffer.from(`${headerB64}.${payloadB64}`);
    const signature = b64urlToBuffer(signatureB64);
    const ok = cryptoVerify(
      'sha256',
      signingInput,
      { key: leaf.publicKey, dsaEncoding: 'ieee-p1363' },
      signature,
    );
    if (!ok) throw receiptValidationFailed('App Store token signature is invalid.');

    const payload = decodeSegment<AppleTransactionPayload>(payloadB64);
    if (payload.productId && req.productStoreIdentifier && payload.productId !== req.productStoreIdentifier) {
      throw receiptValidationFailed(
        `App Store token productId "${payload.productId}" does not match "${req.productStoreIdentifier}".`,
      );
    }

    const isFreeTrial = payload.offerType === 1 && payload.offerDiscountType === 'FREE_TRIAL';
    return {
      purchaseDate: payload.purchaseDate ? new Date(payload.purchaseDate).toISOString() : undefined,
      expiresDate: payload.expiresDate ? new Date(payload.expiresDate).toISOString() : payload.type?.includes('Subscription') ? undefined : null,
      isSandbox: payload.environment === 'Sandbox',
      periodType: isFreeTrial ? 'trial' : payload.offerType ? 'intro' : 'normal',
    };
  }

  private verifyChain(chain: X509Certificate[]): void {
    const now = Date.now();
    for (const cert of chain) {
      if (new Date(cert.validFrom).getTime() > now || new Date(cert.validTo).getTime() < now) {
        throw receiptValidationFailed('An App Store certificate in the chain is expired or not yet valid.');
      }
    }
    // Each cert must be issued by the next one in the chain.
    for (let i = 0; i < chain.length - 1; i++) {
      const child = chain[i]!;
      const issuer = chain[i + 1]!;
      if (!child.verify(issuer.publicKey)) {
        throw receiptValidationFailed('App Store certificate chain is broken.');
      }
    }
    const root = chain[chain.length - 1]!;
    if (this.rootCaPem) {
      let pinned: X509Certificate;
      try {
        pinned = new X509Certificate(this.rootCaPem);
      } catch {
        throw storeProblem('APPLE_ROOT_CA_PEM is not a valid certificate.');
      }
      if (root.fingerprint256 !== pinned.fingerprint256) {
        throw receiptValidationFailed('App Store chain does not terminate at the pinned Apple root CA.');
      }
    }
    // else: chain links verified; set APPLE_ROOT_CA_PEM to pin to Apple Root CA - G3 in production.
  }
}
