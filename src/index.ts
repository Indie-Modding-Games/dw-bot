import { join } from 'node:path';
import { FeedbackService } from './application/services/feedback.service.js';
import { PostIngestor } from './application/services/post-ingestor.js';
import { config } from './config/env.js';
import { startDiscordClient } from './infrastructure/discord/client.js';
import { DiscordBacklogNotifier } from './infrastructure/discord/discord-backlog-notifier.js';
import { DiscordForumSource } from './infrastructure/discord/discord-forum-source.js';
import { JsonFeedbackStore } from './infrastructure/filesystem/json-feedback-store.js';
import { GithubIssueTracker } from './infrastructure/github/github-issue-tracker.js';
import { logger } from './infrastructure/logging/logger.js';
import {
  startFeedbackSyncScheduler,
  type ScheduledJob,
} from './infrastructure/scheduling/feedback-sync-scheduler.js';

/**
 * Punto de entrada y composition root.
 * Iteracion 1: `/help` y `/status` con allowlist.
 * Feedback: `/bug` y `/suggest` hacia GitHub; fichas sincronizadas en el
 * canal de backlog; ingestion de posts de foro (propuestas etiquetadas
 * "Aceptado" y bugs etiquetados "En revision"), con cambio automatico de
 * etiqueta cuando el ticket del proposals llega a done.
 * Si faltan credenciales de GitHub, el modulo queda deshabilitado con aviso
 * y el resto del bot sigue operativo (detalles pendientes).
 */
async function main(): Promise<void> {
  logger.info(
    {
      event: 'boot',
      guildId: config.guildId ?? 'global',
      allowedUsers: config.allowedUserIds.length,
    },
    'arrancando DevBot (Discord adapter)',
  );

  // El router y el scheduler acceden a los servicios de forma perezosa:
  // se construyen despues del login porque necesitan el cliente autenticado.
  let feedbackService: FeedbackService | null = null;
  let postIngestor: PostIngestor | null = null;
  let syncJob: ScheduledJob | null = null;

  const client = await startDiscordClient({
    getFeedback: () => feedbackService,
    getPostIngestor: () => postIngestor,
    getForumPlans: () => config.feedback?.forumPlans ?? [],
  });

  if (config.feedback) {
    try {
      const tracker = new GithubIssueTracker(
        {
          token: config.feedback.githubToken,
          repo: config.feedback.repo,
          bugLabels: config.feedback.bugLabels,
          suggestionLabels: config.feedback.suggestionLabels,
        },
        logger,
      );
      const store = await JsonFeedbackStore.create(
        join(config.feedback.dataDir, 'feedback.json'),
        config.feedback.repo,
        logger,
      );
      const notifier = new DiscordBacklogNotifier(client, config.feedback.backlogChannelId, logger);
      feedbackService = new FeedbackService(tracker, store, notifier, logger);

      if (config.feedback.forumPlans.length > 0) {
        const forumSource = new DiscordForumSource(client, logger);
        postIngestor = new PostIngestor(forumSource, tracker, store, logger);
        logger.info(
          {
            event: 'forums.enabled',
            plans: config.feedback.forumPlans.map((p) => ({
              kind: p.kind,
              channelId: p.channelId,
            })),
          },
          'ingestion de posts de foro habilitada',
        );
      }

      syncJob = startFeedbackSyncScheduler(
        feedbackService,
        config.feedback.syncCron,
        logger,
        postIngestor,
        config.feedback.forumPlans,
      );
      logger.info(
        { event: 'feedback.enabled', repo: config.feedback.repo },
        'modulo de feedback GitHub habilitado (/bug, /suggest y /sync-now operativos)',
      );
    } catch (error) {
      // Config completa pero inicializacion fallo (repo inexistente, etc.):
      // el bot sigue vivo; /bug y /suggest responderan que no esta habilitado.
      logger.error(
        { err: error, event: 'feedback.disabled' },
        'el modulo de feedback no pudo inicializarse; el resto del bot sigue operativo',
      );
    }
  } else if (config.feedbackMissing.length > 0) {
    logger.warn(
      { event: 'feedback.incomplete', missing: config.feedbackMissing },
      'modulo de feedback DESHABILITADO: faltan credenciales/variables en .env (pendiente para mas adelante)',
    );
  } else {
    logger.info(
      { event: 'feedback.off' },
      'modulo de feedback sin configurar: define DEVBOT_GITHUB_TOKEN, DEVBOT_GITHUB_REPO y DEVBOT_FEEDBACK_CHANNEL_ID en .env',
    );
  }

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ event: 'shutdown', signal }, 'apagando DevBot');
    syncJob?.stop();
    await client.destroy();
    process.exit(0);
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => void shutdown(signal));
  }
}

main().catch((error) => {
  logger.fatal({ err: error }, 'fallo fatal al arrancar');
  process.exit(1);
});
