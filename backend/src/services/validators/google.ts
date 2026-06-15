import { createSign } from 'node:crypto';
import { receiptValidationFailed, storeProblem } from '../../errors.js';
import type { StoreValidator, ValidationRequest, ValidationResult } from './types.js';

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Verifies a Google Play purchase token by calling the Android Publisher API with a
 * service-account-signed OAuth token. Handles both subscriptions (subscriptionsv2) and
 * one-time products, returning the authentic purchase/expiry state.
 */
export class GoogleValidator implements StoreValidator {
  private cachedToken: { token: string; expiresAt: number } | null = null;

  constructor(
    private serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
    private packageName = process.env.GOOGLE_PACKAGE_NAME,
  ) {}

  async validate(req: ValidationRequest): Promise<ValidationResult> {
    if (!this.serviceAccountJson || !this.packageName) {
      throw storeProblem('Google Play validation requires GOOGLE_SERVICE_ACCOUNT_JSON and GOOGLE_PACKAGE_NAME.');
    }
    const account = this.parseAccount();
    const accessToken = await this.getAccessToken(account);

    // Try the subscription endpoint first; fall back to the product endpoint.
    const subUrl = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${this.packageName}/purchases/subscriptionsv2/tokens/${encodeURIComponent(req.fetchToken)}`;
    const subRes = await fetch(subUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (subRes.ok) {
      const data = (await subRes.json()) as {
        lineItems?: { expiryTime?: string }[];
        startTime?: string;
        testPurchase?: unknown;
        subscriptionState?: string;
      };
      const expiry = data.lineItems?.map((l) => l.expiryTime).filter(Boolean).sort().at(-1);
      return {
        purchaseDate: data.startTime,
        expiresDate: expiry ?? undefined,
        isSandbox: data.testPurchase !== undefined,
        periodType: 'normal',
      };
    }

    const prodUrl = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${this.packageName}/purchases/products/${encodeURIComponent(req.productStoreIdentifier)}/tokens/${encodeURIComponent(req.fetchToken)}`;
    const prodRes = await fetch(prodUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (prodRes.ok) {
      const data = (await prodRes.json()) as { purchaseTimeMillis?: string; purchaseState?: number; purchaseType?: number };
      if (data.purchaseState === 1) throw receiptValidationFailed('Google Play purchase was cancelled.');
      return {
        purchaseDate: data.purchaseTimeMillis ? new Date(Number(data.purchaseTimeMillis)).toISOString() : undefined,
        expiresDate: null,
        isSandbox: data.purchaseType === 0,
        periodType: 'normal',
      };
    }

    const body = await prodRes.text().catch(() => '');
    throw receiptValidationFailed(`Google Play rejected the purchase token (HTTP ${prodRes.status}). ${body}`.trim());
  }

  private parseAccount(): ServiceAccount {
    try {
      const parsed = JSON.parse(this.serviceAccountJson!) as ServiceAccount;
      if (!parsed.client_email || !parsed.private_key) throw new Error('missing fields');
      return parsed;
    } catch {
      throw storeProblem('GOOGLE_SERVICE_ACCOUNT_JSON is not a valid service account key.');
    }
  }

  private async getAccessToken(account: ServiceAccount): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now() + 30_000) return this.cachedToken.token;
    const tokenUri = account.token_uri ?? 'https://oauth2.googleapis.com/token';
    const now = Math.floor(Date.now() / 1000);
    const claim = { iss: account.client_email, scope: SCOPE, aud: tokenUri, iat: now, exp: now + 3600 };
    const header = { alg: 'RS256', typ: 'JWT' };
    const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;
    const signature = createSign('RSA-SHA256').update(signingInput).sign(account.private_key);
    const jwt = `${signingInput}.${base64url(signature)}`;

    const res = await fetch(tokenUri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
    });
    if (!res.ok) {
      throw storeProblem(`Could not obtain a Google access token (HTTP ${res.status}).`);
    }
    const data = (await res.json()) as { access_token: string; expires_in: number };
    this.cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
    return data.access_token;
  }
}
