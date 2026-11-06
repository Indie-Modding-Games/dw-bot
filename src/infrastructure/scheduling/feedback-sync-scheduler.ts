import { schedule, validate } from 'node-cron';
import type { Logger } from 'pino';
import type { FeedbackService } from '../../application/services/feedback.service.js';

export interface ScheduledJob {
  stop(): void;
}

/**
 * Scheduler del modulo de feedback (node-cron, seccion 6).
 * El sondeo periodico sustituye a un webhook de GitHub: el MVP no expone
 * API publica, asi que consultamos issues actualizadas desde aqui.
 */
export function startFeedbackSyncScheduler(
  service: FeedbackService,
  cronExpression: string,
  logger: Logger,
): ScheduledJob {
  if (!validate(cronExpression)) {
    throw new Error(`DEVBOT_FEEDBACK_CRON invalido: "${cronExpression}"`);
  }

  const task = schedule(cronExpression, () => {
    void (async () => {
      try {
        const summary = await service.syncUpdatedIssues();
        if (summary.cardUpdates > 0 || summary.stateChanges > 0) {
          logger.info({ event: 'feedback.sync', ...summary }, 'backlog sincronizado con Discord');
        } else {
          logger.debug({ event: 'feedback.sync', ...summary }, 'sondeo del backlog sin cambios');
        }
      } catch (error) {
        logger.error(
          { err: error, event: 'feedback.sync_failed' },
          'fallo la sincronizacion del backlog; se reintentara en el proximo tick',
        );
      }
    })();
  });

  logger.info(
    { event: 'feedback.sync_scheduled', cron: cronExpression },
    'sincronizacion GitHub → Discord programada',
  );

  return { stop: () => task.stop() };
}
