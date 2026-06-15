import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { DB } from '../db.js';
import { parse } from '../validate.js';
import { processAppleNotification, processGoogleNotification } from '../services/notifications.js';

const appleSchema = z.object({ signedPayload: z.string().min(1) });
const googleSchema = z.object({ message: z.object({ data: z.string().optional() }).optional() }).passthrough();

/**
 * Store server notification webhooks. These are called by Apple/Google directly (not by
 * an SDK), so there is no API key — the tenant is resolved from the signed bundleId
 * (Apple) / packageName (Google), and authenticity comes from signature verification
 * (Apple, when APPLE_VALIDATION=apple) / the Pub/Sub push endpoint (Google).
 *
 * They always answer 2xx once the payload is understood, so the store does not retry a
 * notification we have already accepted (even if we could not map it to a subscriber).
 */
export function registerNotificationRoutes(app: FastifyInstance, db: DB, config: Config): void {
  // Apple App Store Server Notifications V2
  app.post('/v1/notifications/apple', async (req) => {
    const body = parse(appleSchema, req.body);
    return processAppleNotification(db, config, body.signedPayload);
  });

  // Google Play Real-time Developer Notifications (Pub/Sub push)
  app.post('/v1/notifications/google', async (req) => {
    const body = parse(googleSchema, req.body);
    return processGoogleNotification(db, config, body);
  });
}
