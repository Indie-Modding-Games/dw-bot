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
    createdAt: message.timestamp ?? new Date().toISOString(),
    isBot: message.author?.bot === true,
    type: message.type ?? 0,
    attachments: toPostAttachments(message.attachments),
  };
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

      let description = '_(post sin texto)_';
      let authorName = 'desconocido';
      let attachments: PostAttachment[] = [];
      let starterMessageId: string | null = null;
      try {
        const starter = await this.rest.getThreadStarterMessage(thread.id);
        description = (starter?.content ?? '').slice(0, 3500) || description;
        authorName = starter?.author?.username ?? authorName;
        attachments = toPostAttachments(starter?.attachments);
        starterMessageId = starter?.id ?? null;
      } catch {
        // Sin acceso al mensaje inicial: el nombre del post basta como ticket.
      }

      posts.push({
        channelId,
        threadId: thread.id,
        title: (thread.name ?? 'post sin titulo').slice(0, 250),
        description,
        authorName,
        attachments,
        starterMessageId,
        postUrl: `https://discord.com/channels/${this.env.DEVBOT_GUILD_ID}/${channelId}/${thread.id}`,
      });
    }

    return posts;
  }

  async fetchThreadMessages(
    threadId: string,
    afterMessageId: string | null,
  ): Promise<ForumThreadMessage[]> {
    const messages = await this.rest.fetchThreadMessages(threadId, afterMessageId);
    return messages.map(toThreadMessage);
  }

  async fetchAttachmentBytes(url: string): Promise<ArrayBuffer | null> {
    try {
      return await this.rest.downloadAttachment(url);
    } catch {
      return null;
    }
  }
}
