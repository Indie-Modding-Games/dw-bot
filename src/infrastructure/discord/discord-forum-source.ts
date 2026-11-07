import { ChannelType, type Client } from 'discord.js';
import type { Logger } from 'pino';
import type { ForumPost, ForumPostSourcePort } from '../../core/feedback/types.js';

/**
 * Adaptador: lee posts (hilos) de un canal de FORO de Discord que tengan
 * la etiqueta requerida. `threads.fetch()` devuelve los hilos activos; se
 * paginiza con `before` y se filtra por appliedTags.
 *
 * El texto del ticket es el mensaje inicial del post; el autor del post
 * se registra como "reportedBy" para trazabilidad.
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
        fetchInitialMessage: () => Promise<{
          content: string;
          author: { username: string } | null;
        } | null>;
      }>;
      let description = '_(post sin texto)_';
      let authorName = 'desconocido';
      if (typeof maybeWithInitial.fetchInitialMessage === 'function') {
        const initial = await maybeWithInitial.fetchInitialMessage().catch(() => null);
        description = (initial?.content ?? '').slice(0, 3500) || description;
        authorName = initial?.author?.username ?? authorName;
      }

      posts.push({
        channelId,
        threadId: thread.id,
        title: thread.name.slice(0, 250),
        description,
        authorName,
        postUrl: `https://discord.com/channels/${channel.guild.id}/${thread.id}`,
      });
    }

    return posts;
  }
}
