import { buildApp } from './app.js';
import { ensureRootSecretKey } from './auth.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { checkExpirations } from './services/webhooks.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDb(config.dbPath);
  const rootKey = ensureRootSecretKey(db);

  const app = buildApp({ db, config, logger: true });

  await app.listen({ port: config.port, host: config.host });

  app.log.info(`RevenueDog backend listening on http://${config.host}:${config.port}`);
  app.log.info(`API docs: http://${config.host}:${config.port}/docs`);
  app.log.info(`Root secret key (sk_): ${rootKey}`);
  app.log.info('Use this key as "Authorization: Bearer <key>" for /v1/admin/* endpoints.');

  // Periodically emit expiration/billing-issue events for lapsed subscriptions.
  const sweep = () => {
    try {
      const n = checkExpirations(db);
      if (n > 0) app.log.info(`Emitted ${n} expiration event(s).`);
    } catch (err) {
      app.log.error(err);
    }
  };
  sweep();
  const timer = setInterval(sweep, 60_000);
  timer.unref?.();
}

main().catch((err) => {
  console.error('Failed to start RevenueDog backend:', err);
  process.exit(1);
});
