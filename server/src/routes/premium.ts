import type { FastifyPluginAsync } from 'fastify';
import { config } from '../config.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { checkBan } from '../middleware/checkBan.js';
import { startProTrial } from '../lib/users.js';

/**
 * Routes that mutate Hive-account-scoped premium state.
 *
 * Trial flow is gated behind `ENABLE_PRO_TESTING` so we can roll it out
 * (and turn it off) without redeploying client builds. The user signs
 * in to Hangouts the normal way to get a session JWT, then hits this
 * endpoint. The 3speak-checker side observes the resulting
 * `premium_source='testing' + premium_expires_at` row and lets it
 * expire naturally — re-claiming is blocked forever by the sticky
 * `testing_started` field on the user document.
 */
export const premiumRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/premium/start-testing', {
    preHandler: [requireAuth, checkBan],
  }, async (request, reply) => {
    if (!config.ENABLE_PRO_TESTING) {
      return reply.forbidden('3Speak Pro trial is not currently available');
    }

    const result = await startProTrial(
      request.username,
      config.PRO_TESTING_DURATION_HOURS,
    );

    if (result.ok) {
      return reply.send({
        ok: true,
        durationHours: config.PRO_TESTING_DURATION_HOURS,
        expiresAt: result.expiresAt.toISOString(),
      });
    }

    if (result.reason === 'already_used') {
      return reply.code(409).send({
        ok: false,
        reason: 'already_used',
        message: 'You have already used your one-time Pro trial.',
      });
    }
    if (result.reason === 'banned') {
      return reply.forbidden('Account is banned');
    }
    return reply.code(503).send({
      ok: false,
      reason: result.reason,
      message: 'Could not start trial right now — please try again shortly.',
    });
  });
};
