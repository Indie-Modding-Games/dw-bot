import type { Logger } from 'pino';
import {
  buildCommentBody,
  composePostDescription,
  contentTypeForAttachment,
  isAttachmentHandled,
  MAX_ATTACHMENT_BYTES,
  MAX_COMMENTS_PER_SYNC,
  MAX_UPLOADS_PER_SYNC,
  postSignature,
  SKIPPED_ATTACHMENT,
} from '../../core/feedback/attachments.js';
import { buildIssueBody } from '../../core/feedback/issue-body.js';
import {
  type FeedbackReport,
  type FeedbackStorePort,
  type ForumPost,
  type ForumPostSourcePort,
  type ForumThreadMessage,
  type IssueSnapshot,
  type IssueTrackerPort,
  type PostAttachment,
  type PostSyncPlan,
  type TrackedFeedback,
} from '../../core/feedback/types.js';

export interface IngestionSummary {
  scanned: number;
  created: number;
  /** Posts editados en Discord cuyo titulo/cuerpo se actualizo en GitHub. */
  updated: number;
  /** Respuestas de Discord reenviadas como comentarios de la issue. */
  comments: number;
}

/**
 * Caso de uso: leer posts etiquetados de los canales de foro y convertirlos
 * en tickets del backlog de GitHub, manteniendolos sincronizados despues de
 * la creacion:
 * - post nuevo: se crea la issue con sus capturas subidas a GitHub;
 * - post editado: se actualiza titulo/cuerpo (firma de contenido via hash);
 * - respuestas nuevas del hilo: se reenvian como comentarios de la issue;
 * - cada adjunto se sube UNA sola vez (se rastrea por ID de adjunto).
 * Idempotente: un post ya ingerido nunca se duplica (se rastrea por threadId).
 */
export class PostIngestor {
  constructor(
    private readonly postSource: ForumPostSourcePort,
    private readonly tracker: IssueTrackerPort,
    private readonly store: FeedbackStorePort,
    private readonly logger: Logger,
  ) {}

  async ingestNewPosts(plans: PostSyncPlan[]): Promise<IngestionSummary> {
    const summary: IngestionSummary = { scanned: 0, created: 0, updated: 0, comments: 0 };
    if (plans.length === 0) return summary;

    const recordsByThread = new Map<string, TrackedFeedback>(
      (await this.store.list())
        .filter((record) => record.post?.threadId)
        .map((record) => [record.post?.threadId as string, record]),
    );

    for (const plan of plans) {
      let posts: ForumPost[];
      try {
        posts = await this.postSource.fetchPosts(plan.channelId, plan.requiredTag);
      } catch (error) {
        this.logger.error(
          { err: error, event: 'posts.scan_failed', channelId: plan.channelId },
          'no se pudo leer el canal de foro',
        );
        continue;
      }
      summary.scanned += posts.length;

      for (const post of posts) {
        try {
          const existing = recordsByThread.get(post.threadId);
          if (!existing) {
            const created = await this.createFromPost(plan, post);
            summary.created += 1;
            // Recien creado: solo reenviar respuestas nuevas del post (la
            // creacion ya incluyo el contenido y las capturas subidas).
            const working = this.workingCopy(created);
            summary.comments += await this.forwardThreadComments(working, post.messages);
            const modified = this.wasModified(working, created);
            if (modified) await this.store.upsert(working);
            recordsByThread.set(post.threadId, modified ? working : created);
          } else {
            const sync = await this.syncPostChanges(post, existing);
            summary.updated += sync.updated;
            summary.comments += sync.comments;
            recordsByThread.set(post.threadId, sync.record);
          }
        } catch (error) {
          this.logger.error(
            { err: error, event: 'posts.sync_failed', threadId: post.threadId },
            'no se pudo crear/actualizar el ticket desde el post',
          );
        }
      }
    }

    return summary;
  }

  /** Post nuevo: subir sus capturas a GitHub y crear la issue con el cuerpo completo. */
  private async createFromPost(plan: PostSyncPlan, post: ForumPost): Promise<TrackedFeedback> {
    const uploaded: Record<string, string> = {};
    const fullyUploaded = await this.uploadAttachments(post.attachments, uploaded);

    const report: FeedbackReport = {
      kind: plan.kind,
      title: post.title,
      description: composePostDescription(post, uploaded),
      reportedById: '0',
      reportedByName: `post: ${post.authorName}`,
    };

    const issue = await this.tracker.createIssue(report);
    const record: TrackedFeedback = {
      report,
      issue,
      discordMessageId: null,
      uploadedAttachments: uploaded,
      post: {
        channelId: plan.channelId,
        threadId: post.threadId,
        requiredTag: plan.requiredTag,
        doneTag: plan.doneTag,
        // Si el post no era legible o alguna captura queda pendiente por fallo
        // transitorio, no se guarda la firma: el proximo ciclo reintentara y
        // completara el cuerpo con el contenido real del primer mensaje.
        contentHash: fullyUploaded && post.description !== null ? postSignature(post) : undefined,
        starterMessageId: post.starterMessageId,
        // Marca de agua inicial: las respuestas anteriores al ticket NO se reenvian.
        lastCommentId: post.starterMessageId,
      },
    };
    await this.store.upsert(record);
    this.logger.info(
      {
        event: 'posts.ticket_created',
        threadId: post.threadId,
        issueNumber: issue.number,
        kind: plan.kind,
        uploads: Object.keys(uploaded).length,
      },
      `post ingerido como issue #${issue.number}`,
    );
    return record;
  }

  /** Post ya ingerido: reenviar respuestas nuevas y aplicar ediciones del post. */
  private async syncPostChanges(
    post: ForumPost,
    record: TrackedFeedback,
  ): Promise<{ updated: number; comments: number; record: TrackedFeedback }> {
    if (!record.post) return { updated: 0, comments: 0, record };

    const working = this.workingCopy(record);

    // 1) Respuestas nuevas del hilo -> comentarios de la issue.
    const comments = await this.forwardThreadComments(working, post.messages);

    // Post no legible ESTE ciclo (429, sin acceso): jamas se toca el cuerpo de
    // la issue, para no sobrescribir contenido real con placeholders. La firma
    // vieja queda intacta y el proximo ciclo lo repara con el texto actual.
    if (post.description === null) {
      if (this.wasModified(working, record)) await this.store.upsert(working);
      return { updated: 0, comments, record: working };
    }

    // 2) Edicion del post: comparar firma de contenido (titulo+texto+adjuntos).
    const signature = postSignature(post);
    const currentPost = working.post ?? record.post;
    if (signature === currentPost.contentHash) {
      // Sin edicion: persistir solo si el reenvio de respuestas movio algo.
      if (this.wasModified(working, record)) await this.store.upsert(working);
      return { updated: 0, comments, record: working };
    }

    if (working.issue.state === 'closed') {
      // Issue cerrada: no se reabre contenido por ediciones del post.
      this.logger.info(
        {
          event: 'posts.update_skipped_closed',
          threadId: post.threadId,
          issueNumber: working.issue.number,
        },
        'post editado, pero la issue esta cerrada; no se actualiza el contenido',
      );
      const closed: TrackedFeedback = {
        ...working,
        post: { ...currentPost, contentHash: signature },
      };
      await this.store.upsert(closed);
      return { updated: 0, comments, record: closed };
    }

    // Subir adjuntos nuevos (o reintentar los que fallaron) antes de recomponer el cuerpo.
    const fullyUploaded = await this.uploadAttachments(
      post.attachments,
      working.uploadedAttachments!,
    );

    const report: FeedbackReport = {
      ...working.report,
      title: post.title,
      description: composePostDescription(post, working.uploadedAttachments!),
    };
    let issue: IssueSnapshot;
    try {
      issue = await this.tracker.updateIssue(working.issue.number, {
        title: report.title,
        body: buildIssueBody(report),
      });
    } catch (error) {
      this.logger.error(
        { err: error, event: 'posts.issue_update_failed', issueNumber: working.issue.number },
        'no se pudo actualizar la issue; se reintentara en el proximo tick',
      );
      return { updated: 0, comments, record: working };
    }

    const next: TrackedFeedback = {
      ...working,
      report,
      issue,
      // Si quedo alguna subida pendiente, no se guarda la firma: el proximo
      // tick recompondra el cuerpo con las capturas que falten.
      post: { ...currentPost, contentHash: fullyUploaded ? signature : currentPost.contentHash },
    };
    await this.store.upsert(next);
    this.logger.info(
      { event: 'posts.issue_updated', threadId: post.threadId, issueNumber: issue.number },
      `post editado: issue #${issue.number} actualizada desde Discord`,
    );
    return { updated: 1, comments, record: next };
  }

  /** Copia defensiva del registro: se muta durante el sync y se persiste al final. */
  private workingCopy(record: TrackedFeedback): TrackedFeedback {
    return {
      ...record,
      uploadedAttachments: { ...(record.uploadedAttachments ?? {}) },
      post: record.post ? { ...record.post } : undefined,
    };
  }

  /** true si el reenvio de respuestas movio la marca de agua o subio algo. */
  private wasModified(working: TrackedFeedback, original: TrackedFeedback): boolean {
    return (
      working.post?.lastCommentId !== original.post?.lastCommentId ||
      Object.keys(working.uploadedAttachments ?? {}).length !==
        Object.keys(original.uploadedAttachments ?? {}).length
    );
  }

  /**
   * Reenvia las respuestas nuevas del hilo como comentarios de la issue.
   * Usa los mensajes YA leidos con el post (cero llamadas extra a Discord).
   * Avanza la marca de agua solo con envios exitosos (sin spam ni duplicados).
   */
  private async forwardThreadComments(
    record: TrackedFeedback,
    messages: ForumThreadMessage[] | null,
  ): Promise<number> {
    const postInfo = record.post;
    if (!postInfo || messages === null) return 0;

    const watermark = postInfo.lastCommentId;
    if (watermark === undefined || watermark === null) {
      // Marca de agua desconocida (registro heredado o post no legible al
      // crear): fijarla en el mensaje mas reciente leido SIN reenviar historial.
      postInfo.lastCommentId = newestMessageId(messages.map((message) => message.id));
      return 0;
    }

    const relevant = messages
      .filter((message) => !message.isBot && message.type === 0)
      .filter((message) => message.content.trim() !== '' || message.attachments.length > 0)
      .filter((message) => isAfter(message.id, watermark))
      .slice(0, MAX_COMMENTS_PER_SYNC);

    let forwarded = 0;
    for (const message of relevant) {
      await this.uploadAttachments(message.attachments, record.uploadedAttachments!);
      try {
        await this.tracker.addIssueComment(
          record.issue.number,
          buildCommentBody(message, record.uploadedAttachments!),
        );
        forwarded += 1;
        postInfo.lastCommentId = message.id;
      } catch (error) {
        this.logger.error(
          {
            err: error,
            event: 'posts.comment_failed',
            threadId: postInfo.threadId,
            messageId: message.id,
            issueNumber: record.issue.number,
          },
          'no se pudo reenviar la respuesta como comentario; se reintentara',
        );
        break;
      }
    }
    return forwarded;
  }

  /**
   * Sube a GitHub los adjuntos aun no procesados; `uploaded` se enriquece in
   * situ (ID -> URL del asset, o `skipped` si se descarto a proposito).
   * Devuelve false si algo queda pendiente por error transitorio o presupuesto
   * agotado (la firma del post no se guarda entonces y se reintenta el tick).
   */
  private async uploadAttachments(
    attachments: PostAttachment[],
    uploaded: Record<string, string>,
  ): Promise<boolean> {
    let budget = MAX_UPLOADS_PER_SYNC;
    let allDone = true;
    for (const attachment of attachments) {
      if (isAttachmentHandled(uploaded, attachment.id)) continue;
      if (budget <= 0) {
        allDone = false;
        continue;
      }

      const contentType = contentTypeForAttachment(attachment);
      if (!contentType) {
        uploaded[attachment.id] = SKIPPED_ATTACHMENT; // tipo no soportado: no reintentar
        continue;
      }
      if (typeof attachment.size === 'number' && attachment.size > MAX_ATTACHMENT_BYTES) {
        uploaded[attachment.id] = SKIPPED_ATTACHMENT; // demasiado grande: no reintentar
        continue;
      }

      budget -= 1;
      try {
        const bytes = await this.postSource.fetchAttachmentBytes(attachment.url);
        if (bytes === null) {
          uploaded[attachment.id] = SKIPPED_ATTACHMENT; // URL muerta: no reintentar
          continue;
        }
        if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
          uploaded[attachment.id] = SKIPPED_ATTACHMENT;
          continue;
        }
        uploaded[attachment.id] = await this.tracker.uploadAttachment({
          name: sanitizeFilename(attachment.filename),
          contentType,
          bytes,
        });
      } catch (error) {
        allDone = false; // fallo transitorio: reintentar en el proximo tick
        this.logger.error(
          { err: error, event: 'posts.attachment_upload_failed', attachmentId: attachment.id },
          'no se pudo subir la captura a GitHub; se reintentara',
        );
      }
    }
    return allDone;
  }
}

/** ID de mensaje mas reciente (los snowflakes de Discord son crecientes). */
function newestMessageId(ids: string[]): string | null {
  let best: string | null = null;
  for (const id of ids) {
    if (best === null || isAfter(id, best)) best = id;
  }
  return best;
}

/** true si el snowflake `a` es mas reciente que `b`. */
function isAfter(a: string, b: string): boolean {
  if (a.length !== b.length) return a.length > b.length;
  return a > b;
}

/** Nombres de archivo sanos para el endpoint de uploads de GitHub. */
function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.-]+/g, '_').slice(0, 120) || 'attachment';
}
