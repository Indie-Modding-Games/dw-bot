import { join } from 'node:path';
import { FeedbackService } from './application/services/feedback.service.js';
import { config } from './config/env.js';
import { DiscordBacklogNotifier } from './infrastructure/discord/discord-backlog-notifier.js';
import { startDiscordClient } from './infrastructure/discord/client.js';
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
 * Extension: `/bug` y `/suggest` hacia un backlog de GitHub, con ficha
 * sincronizada en un canal de Discord (aviso + edicion al cambiar estado).
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

  // El router accede al servicio de forma perezosa: se construye tras el login.
  let feedbackService: FeedbackService | null = null;
  let syncJob: ScheduledJob | null = null;

  const client = await startDiscordClient({ getFeedback: () => feedbackService });

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
      syncJob = startFeedbackSyncScheduler(feedbackService, config.feedback.syncCron, logger);
      logger.info(
        { event: 'feedback.enabled', repo: config.feedback.repo },
        'modulo de feedback GitHub habilitado (/bug y /suggest operativos)',
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
