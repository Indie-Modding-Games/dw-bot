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
 * - Cron trigger cada 5 min: ingesta y sincronizacion de posts de foro
 *   (ediciones y respuestas -> GitHub, con capturas subidas como assets) +
 *   sincronizacion GitHub -> Discord (mismos servicios que la version local).
 */
export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/interactions') {
      const body = await request.text();

      let payload: InteractionPayload;
      try {
        payload = JSON.parse(body) as InteractionPayload;
      } catch {
        return new Response('invalid json', { status: 400 });
      }

      const verification = await isValidDiscordRequest({
        publicKey: env.DISCORD_PUBLIC_KEY,
        signature: request.headers.get('x-signature-ed25519'),
        timestamp: request.headers.get('x-signature-timestamp'),
        body,
      });

      // Verificacion estricta siempre (Discord envia firmas invalidas a
      // proposito como chequeo de seguridad y espera 401):
      if (!verification.ok) {
        logger.warn(
          {
            event: 'interaction.bad_signature',
            reason: verification.reason,
            bodyHash: verification.bodyHash,
            sig: request.headers.get('x-signature-ed25519')?.slice(0, 16) ?? '-',
            ts: request.headers.get('x-signature-timestamp') ?? '-',
            bodyLen: body.length,
          },
          'firma invalida: 401',
        );
        return new Response('invalid signature', { status: 401 });
      }

      // PING de Discord = type 1 (documentacion 2026; antes era 0).
      // Responder PONG {"type":1} con Content-Type json.
      if (payload.type === 1) {
        logger.info({ event: 'interaction.ping' }, 'PING verificado: PONG');
        return Response.json({ type: 1 });
      }

      logger.info(
        {
          event: 'interaction.verified',
          reason: verification.reason,
          bodyHash: verification.bodyHash,
          typeValue: String(payload.type),
        },
        'firma valida',
      );

      const interResponse = await handleInteraction(payload, env);
      return Response.json(interResponse);
    }

    return new Response('Andromon — DevBot worker (Cloudflare Workers)');
  },

  async scheduled(_controller, env): Promise<void> {
    const services = buildServices(env);
    try {
      if (services.ingestor && services.plans.length > 0) {
        const ingestion = await services.ingestor.ingestNewPosts(services.plans);
        if (ingestion.created > 0 || ingestion.updated > 0 || ingestion.comments > 0) {
          logger.info(
            { event: 'posts.ingest', ...ingestion },
            'posts de foro sincronizados con el backlog (creaciones/ediciones/respuestas)',
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
