/** Runtime configuration, read from environment variables with sensible dev defaults. */
export interface Config {
  port: number;
  host: string;
  dbPath: string;
  /** Deployment environment. 'production' enables strict safety guards. */
  nodeEnv: 'development' | 'production' | 'test';
  /** Per-store receipt validation mode. */
  appleValidation: 'trust' | 'apple';
  googleValidation: 'trust' | 'google';
  /** CORS allow-list for the dashboard. '*' in dev. */
  corsOrigin: string;
  /** Max requests per IP per minute; 0 disables rate limiting. */
  rateLimitPerMin: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const nodeEnv =
    env.NODE_ENV === 'production' ? 'production' : env.NODE_ENV === 'test' ? 'test' : 'development';
  return {
    port: Number(env.PORT ?? 8787),
    host: env.HOST ?? '0.0.0.0',
    dbPath: env.DATABASE_PATH ?? './data/revenuedog.db',
    nodeEnv,
    appleValidation: env.APPLE_VALIDATION === 'apple' ? 'apple' : 'trust',
    googleValidation: env.GOOGLE_VALIDATION === 'google' ? 'google' : 'trust',
    corsOrigin: env.CORS_ORIGIN ?? '*',
    rateLimitPerMin: env.RATE_LIMIT_PER_MIN !== undefined ? Number(env.RATE_LIMIT_PER_MIN) : 600,
  };
}

/**
 * Production safety guard: receipts must be verified against the real stores.
 * Trust mode accepts whatever the client claims, so anyone can forge a purchase.
 * Refuse to run a production server in that state — fail loud at boot, not silently in prod.
 */
export function assertProductionSafe(config: Config): void {
  if (config.nodeEnv !== 'production') return;
  const insecure: string[] = [];
  if (config.appleValidation === 'trust') insecure.push('APPLE_VALIDATION');
  if (config.googleValidation === 'trust') insecure.push('GOOGLE_VALIDATION');
  if (insecure.length > 0) {
    throw new Error(
      `Refusing to start in production with trust-mode receipt validation (${insecure.join(
        ', ',
      )}=trust). ` +
        `Trust mode accepts forged purchases. Set ${insecure.join(' and ')} to the real store validator ` +
        `('apple'/'google') with credentials, or run with NODE_ENV!=production for local/sandbox testing.`,
    );
  }
  if (config.corsOrigin === '*') {
    throw new Error(
      'Refusing to start in production with CORS_ORIGIN="*". Set CORS_ORIGIN to your dashboard origin.',
    );
  }
}
