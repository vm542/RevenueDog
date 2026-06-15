import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import type { DB } from './db.js';
import { AppError } from './errors.js';
import { registerPublicRoutes } from './routes/public.js';
import { registerAdminRoutes } from './routes/admin.js';
import { buildValidators } from './services/validators.js';

export interface BuildAppOptions {
  db: DB;
  config: Config;
  logger?: boolean;
}

export function buildApp({ db, config, logger = false }: BuildAppOptions): FastifyInstance {
  const app = Fastify({ logger });
  const validators = buildValidators(config);

  // Minimal CORS for the dashboard (no extra dependency).
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', config.corsOrigin);
    reply.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Authorization,Content-Type,X-Platform,X-Platform-Version,X-SDK-Version,X-App-Version');
    if (req.method === 'OPTIONS') reply.code(204).send();
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) {
      reply.code(err.status).send({ error: { code: err.code, message: err.message } });
      return;
    }
    if ((err as { validation?: unknown }).validation) {
      const message = err instanceof Error ? err.message : 'Invalid request.';
      reply.code(400).send({ error: { code: 'invalid_request', message } });
      return;
    }
    app.log.error(err);
    reply.code(500).send({ error: { code: 'internal_error', message: 'An unexpected error occurred.' } });
  });

  app.setNotFoundHandler((_req, reply) => {
    reply.code(404).send({ error: { code: 'resource_not_found', message: 'Unknown endpoint.' } });
  });

  app.get('/health', async () => ({ ok: true, service: 'revenuedog', version: '0.1.0' }));

  registerPublicRoutes(app, db, validators);
  registerAdminRoutes(app, db, validators);

  return app;
}
