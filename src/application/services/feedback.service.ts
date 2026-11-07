import type { Logger } from 'pino';
import {
  isDoneIssue,
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
  /** Cambios de etiqueta en posts de foro por tickets llegados a done. */
  tagSwaps: number;
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
   * para las monitorizadas, edita la ficha del canal, avisa cambios de estado
   * y, si es un post de foro cuyo ticket llego a done, cambia su etiqueta.
   */
  async syncUpdatedIssues(): Promise<SyncSummary> {
    const records = await this.store.list();
    if (records.length === 0) {
      return { checked: 0, cardUpdates: 0, stateChanges: 0, tagSwaps: 0 };
    }

    const lastPoll = await this.store.getLastPollAt();
    // Primera synchronizacion: ventana conservadora de 24 h.
    const since = lastPoll ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
    const updated = await this.tracker.listIssuesUpdatedSince(since);

    let cardUpdates = 0;
    let stateChanges = 0;
    let tagSwaps = 0;

    for (const issue of updated) {
      const record = records.find((item) => item.issue.number === issue.number);
      if (!record) continue;

      const changed = !snapshotsEqual(record.issue, issue);
      // Un swap que fallo se reintenta aunque el snapshot ya este actualizado.
      const pendingSwap = record.tagSwapPending === true && isDoneIssue(issue);
      if (!changed && !pendingSwap) continue;

      if (changed && record.discordMessageId) {
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

      if (changed && statusChanged(record.issue, issue)) {
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

      // Post de foro con ticket llegado a done: quitar la etiqueta de ingestion
      // y poner la de done sobre el propio post. Si falla, queda pendiente y
      // se reintentara en los proximos ticks.
      const justBecameDone = changed && isDoneIssue(issue) && !isDoneIssue(record.issue);
      const doneTag = record.post?.doneTag;
      const swapNeeded =
        doneTag !== null && doneTag !== undefined && (justBecameDone || pendingSwap);

      let swapOk = true;
      if (swapNeeded && record.post && doneTag) {
        try {
          await this.notifier.markPostDone(record.post, issue, doneTag);
          tagSwaps += 1;
        } catch (error) {
          swapOk = false;
          this.logger.error(
            { err: error, event: 'posts.tag_swap_failed', threadId: record.post.threadId },
            'no se pudo cambiar la etiqueta del post; se reintentara',
          );
        }
      }

      await this.store.upsert({
        ...record,
        issue,
        tagSwapPending: swapNeeded && !swapOk ? true : undefined,
      });
    }

    // Segundo reintento: posts con etiqueta pendiente cuyo cierre ya salio de
    // la ventana `since` (el poll no lo devuelve) se consultan directamente.
    const processed = new Set(updated.map((item) => item.number));
    for (const record of records) {
      const post = record.post;
      const doneTag = post?.doneTag;
      if (!record.tagSwapPending || !post || !doneTag) continue;
      if (processed.has(record.issue.number)) continue; // ya gestionado arriba

      const fresh = await this.tracker.getIssue(record.issue.number);
      if (!fresh) continue;

      if (!isDoneIssue(fresh)) {
        // Se reabrio o cambio de motivo: se limpia el pendiente.
        await this.store.upsert({ ...record, issue: fresh, tagSwapPending: undefined });
        continue;
      }

      try {
        await this.notifier.markPostDone(post, fresh, doneTag);
        tagSwaps += 1;
        await this.store.upsert({ ...record, issue: fresh, tagSwapPending: undefined });
      } catch (error) {
        this.logger.error(
          { err: error, event: 'posts.tag_swap_pending_retry_failed', threadId: post.threadId },
          'el reintento pendiente del cambio de etiqueta volvio a fallar',
        );
      }
    }

    await this.store.setLastPollAt(new Date());
    return { checked: updated.length, cardUpdates, stateChanges, tagSwaps };
  }
}
