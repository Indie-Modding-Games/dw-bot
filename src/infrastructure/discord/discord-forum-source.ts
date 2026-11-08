import { ChannelType, MessageType, type Client, type Message } from 'discord.js';
import type { Logger } from 'pino';
import type {
  ForumPost,
  ForumPostSourcePort,
  ForumThreadMessage,
  PostAttachment,
} from '../../core/feedback/types.js';

function toPostAttachments(message: Message): PostAttachment[] {
  return [...message.attachments.values()].map((attachment) => ({
    id: attachment.id,
    filename: attachment.name ?? 'adjunto',
    url: attachment.url,
    contentType: attachment.contentType ?? null,
    size: attachment.size,
  }));
}

function toThreadMessage(message: Message): ForumThreadMessage {
  return {
    id: message.id,
    content: message.content,
    authorName: message.author.username,
    createdAt: message.createdTimestamp
      ? new Date(message.createdTimestamp).toISOString()
      : new Date().toISOString(),
    isBot: message.author.bot,
    type: message.type ?? MessageType.Default,
    attachments: toPostAttachments(message),
  };
}

/**
 * Adaptador: lee posts (hilos) de un canal de FORO de Discord que tengan
 * la etiqueta requerida. `threads.fetch()` devuelve los hilos activos; se
 * paginiza con `before` y se filtra por appliedTags.
 *
 * El texto del ticket es el mensaje inicial del post; el autor del post
 * se registra como "reportedBy" para trazabilidad. Los adjuntos del post
 * y las respuestas se exponen para que el ingestor los sincronice con GitHub.
 */
export class DiscordForumSource implements ForumPostSourcePort {
  constructor(
    private readonly client: Client<true>,
    private readonly logger: Logger,
  ) {}

  async fetchPosts(channelId: string, requiredTag: string): Promise<ForumPost[]> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || channel.type !== ChannelType.GuildForum) {
      throw new Error(`el canal ${channelId} no existe o no es un canal de foro`);
    }

    const tag = channel.availableTags.find(
      (candidate) => candidate.name.toLowerCase() === requiredTag.toLowerCase(),
    );
    if (!tag) {
      this.logger.warn(
        {
          event: 'posts.tag_missing',
          channelId,
          requiredTag,
          available: channel.availableTags.map((t) => t.name),
        },
        `la etiqueta "${requiredTag}" no existe en el foro; no se ingerira nada de este canal`,
      );
      return [];
    }

    const posts: ForumPost[] = [];
    // La lista de hilos activos del servidor no esta paginada (limite alto
    // para un foro personal); filtramos por canal padre.
    const fetched = await channel.threads.fetch();

    for (const thread of fetched.threads.values()) {
      if (thread.parentId !== channel.id) continue;
      if (thread.archived) continue;
      if (!thread.appliedTags.includes(tag.id)) continue;

      // El mensaje inicial no esta en todos los tipos de hilo: acceso defensivo.
      const maybeWithInitial = thread as Partial<{
        fetchInitialMessage: () => Promise<Message | null>;
      }>;
      let description = '_(post sin texto)_';
      let authorName = 'desconocido';
      let attachments: PostAttachment[] = [];
      let starterMessageId: string | null = null;
      if (typeof maybeWithInitial.fetchInitialMessage === 'function') {
        const initial = await maybeWithInitial.fetchInitialMessage().catch(() => null);
        if (initial) {
          description = initial.content.slice(0, 3500) || description;
          authorName = initial.author.username ?? authorName;
          attachments = toPostAttachments(initial);
          starterMessageId = initial.id;
        }
      }

      posts.push({
        channelId,
        threadId: thread.id,
        title: thread.name.slice(0, 250),
        description,
        authorName,
        attachments,
        starterMessageId,
        postUrl: `https://discord.com/channels/${channel.guild.id}/${thread.id}`,
      });
    }

    return posts;
  }

  async fetchThreadMessages(
    threadId: string,
    afterMessageId: string | null,
  ): Promise<ForumThreadMessage[]> {
    const channel = await this.client.channels.fetch(threadId);
    if (!channel || !channel.isTextBased()) return [];
    const fetched = await channel.messages.fetch(
      afterMessageId ? { limit: 100, after: afterMessageId } : { limit: 100 },
    );
    // Collection viene del mas nuevo al mas viejo: orden cronologico de salida.
    return [...fetched.values()].reverse().map(toThreadMessage);
  }

  async fetchAttachmentBytes(url: string): Promise<ArrayBuffer | null> {
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      return await response.arrayBuffer();
    } catch {
      return null;
    }
  }
}
