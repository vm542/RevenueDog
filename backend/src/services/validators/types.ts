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
