import { schedule, validate } from 'node-cron';
import type { Logger } from 'pino';
import type { FeedbackService } from '../../application/services/feedback.service.js';
import type { PostIngestor } from '../../application/services/post-ingestor.js';
import type { PostSyncPlan } from '../../core/feedback/types.js';

export interface ScheduledJob {
  stop(): void;
}

/**
 * Scheduler del modulo de feedback (node-cron, seccion 6).
 * Cada tick: 1) ingiere posts etiquetados de los foros hacia GitHub,
 * 2) sincroniza cambios de GitHub hacia las fichas y etiquetas de Discord.
 * El sondeo periodico sustituye a un webhook: el MVP no expone API publica.
 */
export function startFeedbackSyncScheduler(
  service: FeedbackService,
  cronExpression: string,
  logger: Logger,
  postIngestor?: PostIngestor | null,
  plans?: PostSyncPlan[],
): ScheduledJob {
  if (!validate(cronExpression)) {
    throw new Error(`DEVBOT_FEEDBACK_CRON invalido: "${cronExpression}"`);
  }

  const task = schedule(cronExpression, () => {
    void (async () => {
      try {
        if (postIngestor && plans && plans.length > 0) {
          const ingestion = await postIngestor.ingestNewPosts(plans);
          if (ingestion.created > 0) {
            logger.info(
              { event: 'posts.ingest', ...ingestion },
              'posts de foro ingeridos al backlog',
            );
          }
        }
        const summary = await service.syncUpdatedIssues();
        if (summary.cardUpdates > 0 || summary.stateChanges > 0 || summary.tagSwaps > 0) {
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
