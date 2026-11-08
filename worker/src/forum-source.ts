import type { Logger } from 'pino';
import type {
  ForumPost,
  ForumPostSourcePort,
  ForumThreadMessage,
  PostAttachment,
} from '../../src/core/feedback/types.js';
import type { Env } from './env.js';
import type { DiscordRest, RestAttachment, RestMessage } from './discord-rest.js';

function toPostAttachments(attachments: RestAttachment[] | undefined): PostAttachment[] {
  return (attachments ?? []).map((attachment) => ({
    id: attachment.id,
    filename: attachment.filename,
    url: attachment.url,
    contentType: attachment.content_type ?? null,
    size: attachment.size,
  }));
}

function toThreadMessage(message: RestMessage): ForumThreadMessage {
  return {
    id: message.id,
    content: message.content ?? '',
    authorName: message.author?.username ?? 'desconocido',
    authorId: message.author?.id ?? null,
    createdAt: message.timestamp ?? new Date().toISOString(),
    isBot: message.author?.bot === true,
    type: message.type ?? 0,
    attachments: toPostAttachments(message.attachments),
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

/** Lee posts etiquetados de canales de FORO via REST puro. */
export class WorkerForumSource implements ForumPostSourcePort {
  constructor(
    private readonly rest: DiscordRest,
    private readonly env: Env,
    private readonly logger: Logger,
  ) {}

  async fetchPosts(channelId: string, requiredTag: string): Promise<ForumPost[]> {
    const forum = await this.rest.getChannel(channelId);
    const tag = (forum.available_tags ?? []).find(
      (candidate) => candidate.name.toLowerCase() === requiredTag.toLowerCase(),
    );
    if (!tag) {
      this.logger.warn(
        {
          event: 'posts.tag_missing',
          channelId,
          requiredTag,
          available: (forum.available_tags ?? []).map((t) => t.name),
        },
        `la etiqueta "${requiredTag}" no existe en el foro; no se ingerira nada de este canal`,
      );
      return [];
    }

    const threads = await this.rest.listActiveThreads(this.env.DEVBOT_GUILD_ID);
    const posts: ForumPost[] = [];

    for (const thread of threads) {
      if (thread.parent_id !== channelId) continue;
      if (thread.thread_metadata?.archived) continue;
      if (!(thread.applied_tags ?? []).includes(tag.id)) continue;

      let description: string | null = null;
      let authorName = 'desconocido';
      let attachments: PostAttachment[] = [];
      let starterMessageId: string | null = null;
      let watermarkMessageId: string | null = null;
      let messages: ForumThreadMessage[] | null = null;

      try {
        // UNA sola lectura del hilo: de ahi salen el mensaje inicial, el
        // texto de respaldo del OP y las respuestas nuevas.
        const page = await this.rest.fetchThreadMessages(thread.id, null);
        if (page.length > 0) {
          messages = page.map(toThreadMessage);
          // Orden cronologico: el starter es el primero.
          const starter = messages[0] as ForumThreadMessage;
          starterMessageId = starter.id;
          authorName = starter.authorName;
          attachments = starter.attachments;

          let text = starter.content;
          let source = starter;
          if (!text.trim()) {
            // Mensaje inicial vacio: el OP escribio en el chat del post.
            // Tomar su primer mensaje con texto (y sus adjuntos) como cuerpo.
            const opFollow = messages
              .slice(1)
              .find(
                (m) =>
                  !m.isBot &&
                  m.type === 0 &&
                  m.content.trim() !== '' &&
                  (starter.authorId !== null
                    ? m.authorId === starter.authorId
                    : m.authorName === starter.authorName),
              );
            if (opFollow) {
              text = opFollow.content;
              source = opFollow;
              attachments = dedupeAttachments([...starter.attachments, ...opFollow.attachments]);
            }
          }

          description = text.slice(0, 3500) || '_(post sin texto)_';
          // No reenviar como comentario el mensaje del que ya se tomo el cuerpo.
          watermarkMessageId = source.id;
        }
        // page vacio => description sigue null: NO se toca la issue (evita
        // borrar el cuerpo por un 429/lectura fallida).
      } catch (error) {
        // Sin acceso al mensaje inicial: la issue conserva su contenido actual.
        this.logger.warn(
          { err: error, event: 'posts.starter_read_failed', threadId: thread.id },
          'no se pudo leer el hilo este ciclo; la issue no se modifica',
        );
      }

      posts.push({
        channelId,
        threadId: thread.id,
        title: (thread.name ?? 'post sin titulo').slice(0, 250),
        description,
        authorName,
        attachments,
        starterMessageId,
        watermarkMessageId,
        messages,
        postUrl: `https://discord.com/channels/${this.env.DEVBOT_GUILD_ID}/${channelId}/${thread.id}`,
      });
    }

    return posts;
  }

  async fetchAttachmentBytes(url: string): Promise<ArrayBuffer | null> {
    try {
      return await this.rest.downloadAttachment(url);
    } catch {
      return null;
    }
  }
}
