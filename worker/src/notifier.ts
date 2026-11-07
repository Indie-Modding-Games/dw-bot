import type { Logger } from 'pino';
import {
  FEEDBACK_EMOJI,
  type BacklogNotifierPort,
  type FeedbackReport,
  type IssueSnapshot,
  type TrackedPostInfo,
} from '../../src/core/feedback/types.js';
import type { Env } from './env.js';
import type { DiscordRest } from './discord-rest.js';

const STATE_COLORS = { open: 0x2ea043, closed: 0x8250df };

/** Notificador de backlog para Workers: REST puro, sin discord.js. */
export class WorkerBacklogNotifier implements BacklogNotifierPort {
  constructor(
    private readonly rest: DiscordRest,
    private readonly env: Env,
    private readonly logger: Logger,
  ) {}

  async publishIssueCard(report: FeedbackReport, issue: IssueSnapshot): Promise<string> {
    const message = await this.rest.sendEmbed(
      this.env.DEVBOT_FEEDBACK_CHANNEL_ID,
      buildIssueEmbed(report, issue),
    );
    this.logger.info(
      { event: 'feedback.card_published', issueNumber: issue.number, messageId: message.id },
      'ficha del backlog publicada en Discord',
    );
    return message.id;
  }

  async updateIssueCard(messageId: string, issue: IssueSnapshot): Promise<void> {
    await this.rest.editEmbed(
      this.env.DEVBOT_FEEDBACK_CHANNEL_ID,
      messageId,
      buildIssueEmbed(null, issue),
    );
    this.logger.info(
      { event: 'feedback.card_updated', issueNumber: issue.number, messageId },
      'ficha del backlog actualizada en Discord',
    );
  }

  async notifyStatusChange(issue: IssueSnapshot, previous: IssueSnapshot): Promise<void> {
    await this.rest.sendText(
      this.env.DEVBOT_FEEDBACK_CHANNEL_ID,
      buildStatusNotice(issue, previous),
    );
    this.logger.info(
      { event: 'feedback.status_notified', issueNumber: issue.number },
      'cambio de estado notificado en el canal de backlog',
    );
  }

  async markPostDone(
    post: TrackedPostInfo,
    issue: IssueSnapshot,
    doneTagName: string,
  ): Promise<void> {
    const forum = await this.rest.getChannel(post.channelId);
    const findTag = (name: string) =>
      (forum.available_tags ?? []).find(
        (tag) => tag.name.toLowerCase() === (name ?? '').trim().toLowerCase(),
      );

    const doneTag = findTag(doneTagName);
    if (!doneTag) {
      throw new Error(
        `la etiqueta de done "${doneTagName}" no existe en el foro ${forum.name ?? post.channelId}; disponible: ${(forum.available_tags ?? []).map((t) => t.name).join(', ') || '(ninguna)'}`,
      );
    }
    const requiredTag = findTag(post.requiredTag);

    const thread = await this.rest.getChannel(post.threadId);
    const currentTags = thread.applied_tags ?? [];
    const nextTags = currentTags.filter((id) => id !== requiredTag?.id && id !== doneTag.id);
    nextTags.push(doneTag.id);
    await this.rest.setThreadAppliedTags(post.threadId, nextTags);

    await this.rest
      .sendText(
        post.threadId,
        `✅ Ticket **#${issue.number}** cerrado como completado en el backlog de GitHub: ${issue.url}`,
      )
      .catch(() => undefined);

    this.logger.info(
      { event: 'posts.tag_swapped', threadId: post.threadId, doneTag: doneTagName },
      'etiqueta del post cambiada por ticket done',
    );
  }
}

function buildIssueEmbed(
  report: FeedbackReport | null,
  issue: IssueSnapshot,
): Record<string, unknown> {
  const emoji = report ? FEEDBACK_EMOJI[report.kind] : '📌';
  const kindLabel = report ? (report.kind === 'bug' ? 'Bug' : 'Sugerencia') : 'Backlog';
  return {
    title: `${emoji} [${kindLabel}] ${issue.title}`,
    url: issue.url,
    color: STATE_COLORS[issue.state],
    description: report ? report.description.slice(0, 1024) : `[Ver issue en GitHub](${issue.url})`,
    fields: [
      { name: 'Estado', value: formatState(issue), inline: true },
      {
        name: 'Etiquetas',
        value:
          issue.labels.length > 0
            ? issue.labels.map((l) => `\`${l}\``).join(' ')
            : '_sin etiquetas_',
        inline: true,
      },
    ],
    footer: { text: `Issue #${issue.number} · sincronizado por DevBot (Cloudflare Workers)` },
    timestamp: issue.updatedAt,
  };
}

function formatState(issue: IssueSnapshot): string {
  if (issue.state === 'open') return '🟢 Abierta';
  const reason = translateStateReason(issue.stateReason);
  return reason ? `🔴 Cerrada (${reason})` : '🔴 Cerrada';
}

function translateStateReason(reason: string | null): string | null {
  switch (reason) {
    case 'completed':
      return 'completada';
    case 'not_planned':
      return 'no prevista';
    case 'reopened':
      return 'reabierta';
    default:
      return null;
  }
}

function buildStatusNotice(issue: IssueSnapshot, previous: IssueSnapshot): string {
  const target = `Issue #${issue.number} **${issue.title}**`;
  if (issue.state === 'closed') {
    const notPlanned = issue.stateReason === 'not_planned' ? ' (marcada como no prevista)' : '';
    return `🔴 ${target} fue **cerrada**${notPlanned} en el backlog: ${issue.url}`;
  }
  if (previous.state === 'closed') {
    return `🟢 ${target} fue **reabierta** en el backlog: ${issue.url}`;
  }
  return `🔄 ${target} fue **actualizada** en el backlog: ${issue.url}`;
}
