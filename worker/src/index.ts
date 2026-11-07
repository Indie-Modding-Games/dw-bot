import type { ExportedHandler } from '@cloudflare/workers-types';
import type { Env } from './env.js';
import { isValidDiscordRequest } from './verify.js';
import { handleInteraction, type InteractionPayload } from './handlers.js';
import { buildServices } from './services.js';
import { logger } from './logger.js';

/**
 * Andromon en Cloudflare Workers (costo $0):
 * - POST /interactions: Discord llama aqui con cada slash command
 *   (Interactions Endpoint; sin gateway, sin servidor permanente).
 * - Cron trigger cada 5 min: ingesta de posts de foro + sincronizacion
 *   GitHub -> Discord (mismos servicios que la version local).
 */
export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/interactions') {
      const body = await request.text();
      const ok = await isValidDiscordRequest({
        publicKey: env.DISCORD_PUBLIC_KEY,
        signature: request.headers.get('x-signature'),
        timestamp: request.headers.get('x-signature-timestamp'),
        body,
      });
      if (!ok) {
        logger.warn({ event: 'interaction.bad_signature' }, 'firma de Discord invalida');
        return new Response('invalid signature', { status: 401 });
      }

      let payload: InteractionPayload;
      try {
        payload = JSON.parse(body) as InteractionPayload;
      } catch {
        return new Response('invalid json', { status: 400 });
      }

      const result = await handleInteraction(payload, env);
      return Response.json(result);
    }

    return new Response('Andromon — DevBot worker (Cloudflare Workers)');
  },

  async scheduled(_controller, env): Promise<void> {
    const services = buildServices(env);
    try {
      if (services.ingestor && services.plans.length > 0) {
        const ingestion = await services.ingestor.ingestNewPosts(services.plans);
        if (ingestion.created > 0) {
          logger.info(
            { event: 'posts.ingest', ...ingestion },
            'posts de foro ingeridos al backlog',
          );
        }
      }
      const summary = await services.service.syncUpdatedIssues();
      if (summary.cardUpdates > 0 || summary.stateChanges > 0 || summary.tagSwaps > 0) {
        logger.info({ event: 'feedback.sync', ...summary }, 'backlog sincronizado con Discord');
      } else {
        logger.debug({ event: 'feedback.sync', ...summary }, 'sondeo del backlog sin cambios');
      }
    } catch (error) {
      logger.error({ err: error, event: 'cron.failed' }, 'fallo el ciclo programado');
    }
  },
} satisfies ExportedHandler<Env>;
