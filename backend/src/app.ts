import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import type { DB } from './db.js';
import { AppError } from './errors.js';
import { registerAccountRoutes } from './routes/accounts.js';
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

  // --- Interactive API docs (public) ---
  app.get('/openapi.json', async (_req, reply) => {
    const spec = loadOpenApiSpec();
    if (!spec) {
      reply.code(404).send({ error: { code: 'resource_not_found', message: 'OpenAPI spec not found. Generate docs/openapi.json.' } });
      return;
    }
    reply.header('Content-Type', 'application/json').send(spec);
  });

  app.get('/docs', async (_req, reply) => {
    reply.header('Content-Type', 'text/html').send(REDOC_HTML);
  });

  registerAccountRoutes(app, db);
  registerPublicRoutes(app, db, validators);
  registerAdminRoutes(app, db, validators, config);

  return app;
}

function loadOpenApiSpec(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.OPENAPI_PATH,
    join(process.cwd(), '..', 'docs', 'openapi.json'),
    join(here, '..', '..', 'docs', 'openapi.json'),
    join(here, '..', '..', '..', 'docs', 'openapi.json'),
  ].filter(Boolean) as string[];
  for (const path of candidates) {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      // try next
    }
  }
  return null;
}

const REDOC_HTML = `<!doctype html>
<html>
  <head>
    <title>RevenueDog API</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>body { margin: 0; }</style>
  </head>
  <body>
    <redoc spec-url="/openapi.json" theme='{"colors":{"primary":{"main":"#6366f1"}}}'></redoc>
    <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
  </body>
</html>`;
