import { ChannelType, EmbedBuilder, type Client, type GuildTextBasedChannel } from 'discord.js';
import type { Logger } from 'pino';
import {
  FEEDBACK_EMOJI,
  type BacklogNotifierPort,
  type FeedbackReport,
  type IssueSnapshot,
  type TrackedPostInfo,
} from '../../core/feedback/types.js';

const STATE_COLORS = { open: 0x2ea043, closed: 0x8250df } as const;

/**
 * Adaptador Discord del backlog: publica fichas como embeds, las edita
 * cuando cambia la issue y avisa transiciones de estado.
 *
 * Requisitos del canal (para el bot): View Channel, Send Messages y
 * Embed Links.
 */
export class DiscordBacklogNotifier implements BacklogNotifierPort {
  constructor(
    private readonly client: Client<true>,
    private readonly channelId: string,
    private readonly logger: Logger,
  ) {}

  async publishIssueCard(report: FeedbackReport, issue: IssueSnapshot): Promise<string> {
    const channel = await this.getSendableChannel();
    const message = await channel.send({ embeds: [buildIssueEmbed(report, issue)] });
    this.logger.info(
      { event: 'feedback.card_published', issueNumber: issue.number, messageId: message.id },
      'ficha del backlog publicada en Discord',
    );
    return message.id;
  }

  async updateIssueCard(messageId: string, issue: IssueSnapshot): Promise<void> {
    const channel = await this.getSendableChannel();
    await channel.messages.edit(messageId, { embeds: [buildIssueEmbed(null, issue)] });
    this.logger.info(
      { event: 'feedback.card_updated', issueNumber: issue.number, messageId },
      'ficha del backlog actualizada en Discord',
    );
  }

  async notifyStatusChange(issue: IssueSnapshot, previous: IssueSnapshot): Promise<void> {
    const channel = await this.getSendableChannel();
    await channel.send({ content: buildStatusNotice(issue, previous) });
    this.logger.info(
      {
        event: 'feedback.status_notified',
        issueNumber: issue.number,
        from: `${previous.state}/${previous.stateReason ?? '-'}`,
        to: `${issue.state}/${issue.stateReason ?? '-'}`,
      },
      'cambio de estado notificado en el canal de backlog',
    );
  }

  /**
   * Cambia la etiqueta del post de foro: quita la de ingestion ("Aceptado")
   * y pone la de done ("Hecho"), deja constancia con un comentario en el
   * propio post y lo ARCHIVA (bloqueado, fuera del foro activo y de las
   * busquedas, historial intacto). Requiere Manage Threads en el canal de foro.
   */
  async markPostDone(
    post: TrackedPostInfo,
    issue: IssueSnapshot,
    doneTagName: string,
  ): Promise<void> {
    const forum = await this.client.channels.fetch(post.channelId);
    if (!forum || forum.type !== ChannelType.GuildForum) {
      throw new Error(`el canal ${post.channelId} ya no es un foro`);
    }

    const doneTag = forum.availableTags.find(
      (tag) => tag.name.toLowerCase() === doneTagName.toLowerCase(),
    );
    if (!doneTag) {
      throw new Error(
        `la etiqueta de done "${doneTagName}" no existe en el foro ${forum.name}; disponible: ${forum.availableTags.map((t) => t.name).join(', ') || '(ninguna)'}`,
      );
    }

    const requiredTag = forum.availableTags.find(
      (tag) => tag.name.toLowerCase() === post.requiredTag.toLowerCase(),
    );

    const thread = await this.client.channels.fetch(post.threadId);
    if (!thread || !thread.isThread()) {
      throw new Error(`el post ${post.threadId} ya no existe`);
    }

    const nextTags = thread.appliedTags.filter((id) => id !== requiredTag?.id && id !== doneTag.id);
    nextTags.push(doneTag.id);
    await thread.setAppliedTags(nextTags);

    // Aviso dentro del propio post, sin romper si falla.
    await thread
      .send({
        content: `✅ Ticket **#${issue.number}** cerrado como completado en el backlog de GitHub: ${issue.url}`,
      })
      .catch(() => undefined);

    // Archivar el post: sale del foro activo y de las busquedas (desarchivable).
    // Si falla, el swap queda pendiente y se reintenta en el proximo tick.
    await thread.setArchived(true);

    this.logger.info(
      { event: 'posts.tag_swapped', threadId: post.threadId, doneTag: doneTagName, archived: true },
      'post etiquetado como done y archivado por ticket cerrado',
    );
  }

  private async getSendableChannel(): Promise<GuildTextBasedChannel> {
    // channels.fetch funciona via REST una vez el cliente esta autenticado.
    // El canal de backlog debe ser un canal de servidor (texto o hilo).
    const fetched = (await this.client.channels.fetch(this.channelId)) as unknown as
      (GuildTextBasedChannel & { send?: unknown }) | null;
    if (!fetched || typeof fetched.send !== 'function') {
      throw new Error(
        `el canal de backlog ${this.channelId} no existe, no es un canal de servidor o el bot no puede escribir en el`,
      );
    }
    return fetched;
  }
}

function buildIssueEmbed(report: FeedbackReport | null, issue: IssueSnapshot): EmbedBuilder {
  const emoji = report ? FEEDBACK_EMOJI[report.kind] : '📌';
  const kindLabel = report ? (report.kind === 'bug' ? 'Bug' : 'Sugerencia') : 'Backlog';

  const embed = new EmbedBuilder()
    .setColor(STATE_COLORS[issue.state])
    .setTitle(`${emoji} [${kindLabel}] ${issue.title}`)
    .setURL(issue.url)
    .addFields(
      { name: 'Estado', value: formatState(issue), inline: true },
      {
        name: 'Etiquetas',
        value:
          issue.labels.length > 0
            ? issue.labels.map((l) => `\`${l}\``).join(' ')
            : '_sin etiquetas_',
        inline: true,
      },
    )
    .setFooter({ text: `Issue #${issue.number} · sincronizado por DevBot` })
    .setTimestamp(new Date(issue.updatedAt));

  if (report) {
    embed.setDescription(report.description.slice(0, 1024));
  } else {
    embed.setDescription(`[Ver issue en GitHub](${issue.url})`);
  }
  return embed;
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
