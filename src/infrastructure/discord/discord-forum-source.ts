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
    authorId: message.author.id,
    createdAt: message.createdTimestamp
      ? new Date(message.createdTimestamp).toISOString()
      : new Date().toISOString(),
    isBot: message.author.bot,
    type: message.type ?? MessageType.Default,
    attachments: toPostAttachments(message),
  };
}

function dedupeAttachments(list: PostAttachment[]): PostAttachment[] {
  const seen = new Set<string>();
  const out: PostAttachment[] = [];
  for (const attachment of list) {
    if (seen.has(attachment.id)) continue;
    seen.add(attachment.id);
    out.push(attachment);
  }
  return out;
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

      let authorName = 'desconocido';
      let starterAuthorId: string | null = null;
      let attachments: PostAttachment[] = [];
      let starterMessageId: string | null = null;
      let starterText: string | null = null; // null = mensaje inicial no legible

      // El mensaje inicial no esta en todos los tipos de hilo: acceso defensivo.
      const maybeWithInitial = thread as Partial<{
        fetchInitialMessage: () => Promise<Message | null>;
      }>;
      if (typeof maybeWithInitial.fetchInitialMessage === 'function') {
        const initial = await maybeWithInitial.fetchInitialMessage().catch(() => null);
        if (initial) {
          starterText = initial.content;
          authorName = initial.author.username;
          starterAuthorId = initial.author.id;
          attachments = toPostAttachments(initial);
          starterMessageId = initial.id;
        }
      }

      const messages = await thread.messages
        .fetch({ limit: 100 })
        .then((page) =>
          // Collection del mas nuevo al mas viejo -> orden cronologico.
          [...page.values()].reverse().map(toThreadMessage),
        )
        .catch(() => null);

      // El cuerpo usa el primer mensaje con texto del OP: el starter si tiene
      // contenido; si no, su primer mensaje en el chat del post.
      // description null (starter no legible) = la issue conserva su cuerpo.
      let watermarkMessageId: string | null = null;
      let description: string | null = null;
      if (starterText !== null) {
        let text = starterText;
        let sourceMessageId = starterMessageId;
        if (!text.trim()) {
          const opFollow = (messages ?? [])
            .filter(
              (m) =>
                !m.isBot && m.type === 0 && m.content.trim() !== '' && m.id !== starterMessageId,
            )
            .find((m) =>
              starterAuthorId !== null
                ? m.authorId === starterAuthorId
                : m.authorName === authorName,
            );
          if (opFollow) {
            text = opFollow.content;
            sourceMessageId = opFollow.id;
            attachments = dedupeAttachments([...attachments, ...opFollow.attachments]);
          }
        }
        description = text.slice(0, 3500) || '_(post sin texto)_';
        // No reenviar como comentario el mensaje del que ya se tomo el cuerpo.
        watermarkMessageId = sourceMessageId;
      }

      posts.push({
        channelId,
        threadId: thread.id,
        title: thread.name.slice(0, 250),
        description,
        authorName,
        attachments,
        starterMessageId,
        watermarkMessageId,
        messages,
        postUrl: `https://discord.com/channels/${channel.guild.id}/${thread.id}`,
      });
    }

    return posts;
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
