/** Runtime configuration, read from environment variables with sensible dev defaults. */
export interface Config {
  port: number;
  host: string;
  dbPath: string;
  /** Per-store receipt validation mode. */
  appleValidation: 'trust' | 'apple';
  googleValidation: 'trust' | 'google';
  /** CORS allow-list for the dashboard. '*' in dev. */
  corsOrigin: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT ?? 8787),
    host: env.HOST ?? '0.0.0.0',
    dbPath: env.DATABASE_PATH ?? './data/revenuedog.db',
    appleValidation: env.APPLE_VALIDATION === 'apple' ? 'apple' : 'trust',
    googleValidation: env.GOOGLE_VALIDATION === 'google' ? 'google' : 'trust',
    corsOrigin: env.CORS_ORIGIN ?? '*',
  };
}
