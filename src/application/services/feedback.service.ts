import type { Logger } from 'pino';
import {
  snapshotsEqual,
  statusChanged,
  type BacklogNotifierPort,
  type FeedbackReport,
  type FeedbackStorePort,
  type IssueTrackerPort,
  type TrackedFeedback,
} from '../../core/feedback/types.js';

export interface SyncSummary {
  checked: number;
  cardUpdates: number;
  stateChanges: number;
}

/**
 * Casos de uso del feedback (capa de aplicacion). Orquesta los puertos:
 * tracker de issues, store de seguimiento y notificador de Discord.
 * No conoce discord.js ni la API de GitHub.
 */
export class FeedbackService {
  constructor(
    private readonly tracker: IssueTrackerPort,
    private readonly store: FeedbackStorePort,
    private readonly notifier: BacklogNotifierPort,
    private readonly logger: Logger,
  ) {}

  /** Reportar un bug/sugerencia: crear issue en GitHub y publicar la ficha. */
  async submitReport(report: FeedbackReport): Promise<TrackedFeedback> {
    const issue = await this.tracker.createIssue(report);

    let discordMessageId: string | null = null;
    try {
      discordMessageId = await this.notifier.publishIssueCard(report, issue);
    } catch (error) {
      // La issue ya existe en GitHub; no duplicarla si Discord falla.
      this.logger.error(
        { err: error, event: 'feedback.card_publish_failed', issueNumber: issue.number },
        'no se pudo publicar la ficha en Discord; la issue en GitHub sigue creada',
      );
    }

    const record: TrackedFeedback = { report, issue, discordMessageId };
    await this.store.upsert(record);
    return record;
  }

  /**
   * Sincronizar: consulta issues actualizadas desde el ultimo sondeo y,
   * para las monitorizadas, edita la ficha del canal y avisa cambios de estado.
   */
  async syncUpdatedIssues(): Promise<SyncSummary> {
    const records = await this.store.list();
    if (records.length === 0) {
      return { checked: 0, cardUpdates: 0, stateChanges: 0 };
    }

    const lastPoll = await this.store.getLastPollAt();
    // Primera synchronizacion: ventana conservadora de 24 h.
    const since = lastPoll ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
    const updated = await this.tracker.listIssuesUpdatedSince(since);

    let cardUpdates = 0;
    let stateChanges = 0;

    for (const issue of updated) {
      const record = records.find((item) => item.issue.number === issue.number);
      if (!record || snapshotsEqual(record.issue, issue)) continue;

      const stateHasChanged = statusChanged(record.issue, issue);

      if (record.discordMessageId) {
        try {
          await this.notifier.updateIssueCard(record.discordMessageId, issue);
          cardUpdates += 1;
        } catch (error) {
          this.logger.error(
            { err: error, event: 'feedback.card_update_failed', issueNumber: issue.number },
            'no se pudo editar la ficha en Discord',
          );
        }
      }

      if (stateHasChanged) {
        try {
          await this.notifier.notifyStatusChange(issue, record.issue);
          stateChanges += 1;
        } catch (error) {
          this.logger.error(
            { err: error, event: 'feedback.status_notify_failed', issueNumber: issue.number },
            'no se pudo notificar el cambio de estado en Discord',
          );
        }
      }

      await this.store.upsert({ ...record, issue });
    }

    await this.store.setLastPollAt(new Date());
    return { checked: updated.length, cardUpdates, stateChanges };
  }
}
