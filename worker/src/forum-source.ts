import type { Logger } from 'pino';
import type { ForumPost, ForumPostSourcePort } from '../../src/core/feedback/types.js';
import type { Env } from './env.js';
import type { DiscordRest } from './discord-rest.js';

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
      try {
        const starter = await this.rest.getThreadStarterMessage(thread.id);
        description = (starter?.content ?? '').slice(0, 3500) || description;
        authorName = starter?.author?.username ?? authorName;
      } catch {
        // Sin acceso al mensaje inicial: el nombre del post basta como ticket.
      }

      posts.push({
        channelId,
        threadId: thread.id,
        title: (thread.name ?? 'post sin titulo').slice(0, 250),
        description,
        authorName,
        postUrl: `https://discord.com/channels/${this.env.DEVBOT_GUILD_ID}/${channelId}/${thread.id}`,
      });
    }

    return posts;
  }
}
