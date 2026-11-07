import type { Logger } from 'pino';
import {
  type FeedbackReport,
  type FeedbackStorePort,
  type ForumPost,
  type ForumPostSourcePort,
  type IssueTrackerPort,
  type PostSyncPlan,
} from '../../core/feedback/types.js';

export interface IngestionSummary {
  scanned: number;
  created: number;
}

/**
 * Caso de uso: leer posts etiquetados de los canales de foro y convertirlos
 * en tickets del backlog de GitHub. Idempotente: un post ya ingerido nunca
 * se duplica (se rastrea por threadId en el store).
 */
export class PostIngestor {
  constructor(
    private readonly postSource: ForumPostSourcePort,
    private readonly tracker: IssueTrackerPort,
    private readonly store: FeedbackStorePort,
    private readonly logger: Logger,
  ) {}

  async ingestNewPosts(plans: PostSyncPlan[]): Promise<IngestionSummary> {
    if (plans.length === 0) return { scanned: 0, created: 0 };

    const existing = await this.store.list();
    const trackedThreads = new Set(existing.map((record) => record.post?.threadId).filter(Boolean));

    let scanned = 0;
    let created = 0;

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
      scanned += posts.length;

      for (const post of posts) {
        if (trackedThreads.has(post.threadId)) continue;
        try {
          await this.createTicketFromPost(plan, post);
          trackedThreads.add(post.threadId);
          created += 1;
        } catch (error) {
          this.logger.error(
            { err: error, event: 'posts.ticket_failed', threadId: post.threadId },
            'no se pudo crear el ticket desde el post',
          );
        }
      }
    }

    return { scanned, created };
  }

  private async createTicketFromPost(plan: PostSyncPlan, post: ForumPost): Promise<void> {
    const report: FeedbackReport = {
      kind: plan.kind,
      title: post.title,
      description: `${post.description}\n\n[Ver post original en Discord](${post.postUrl})`,
      reportedById: '0',
      reportedByName: `post: ${post.authorName}`,
    };

    const issue = await this.tracker.createIssue(report);
    await this.store.upsert({
      report,
      issue,
      discordMessageId: null,
      post: {
        channelId: plan.channelId,
        threadId: post.threadId,
        requiredTag: plan.requiredTag,
        doneTag: plan.doneTag,
      },
    });
    this.logger.info(
      {
        event: 'posts.ticket_created',
        threadId: post.threadId,
        issueNumber: issue.number,
        kind: plan.kind,
      },
      `post ingerido como issue #${issue.number}`,
    );
  }
}
